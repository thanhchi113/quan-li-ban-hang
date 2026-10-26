'use strict';

const http = require('node:http');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const {
  todayVN,
  parseSheetRows,
  buildBatchRowWrite,
  buildReminderPlans,
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
} = require('./lib');

const SPREADSHEET_ID = '1t1WTrgrfVv_WbUG-Zl2ORwwjGWzgV0XodD9WnNvp8ZE';
const SHEET_RANGE = "'Trang tính1'!A1:O1000";
const OWNER_EMAIL = 'badaoqn132@gmail.com';
const DEFAULT_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD || 'badao132';
const PORT = Number(process.env.PORT || 3456);
const HOST = process.env.HOST || '127.0.0.1';

const SYNC_FILE = path.join(__dirname, 'synced-reminders.json');
const AUTH_FILE = path.join(__dirname, 'auth-config.json');
const PUBLIC_URL_FILE = path.join(__dirname, 'public-url.txt');
const INDEX_FILE = fs.existsSync(path.join(__dirname, 'index.html'))
  ? path.join(__dirname, 'index.html')
  : path.join(__dirname, 'public', 'index.html');

function resolveCliBinary(toolName) {
  const appData = process.env.ANTIGRAVITY_APP_DATA_DIR || path.join(os.homedir(), '.gemini', 'antigravity');
  const binDir = path.join(appData, 'plugin_data', toolName, 'bin');
  if (fs.existsSync(binDir)) {
    const exes = fs
      .readdirSync(binDir)
      .filter((f) => f.startsWith(`${toolName}-`) && f.endsWith('.exe'))
      .sort()
      .reverse();
    if (exes.length > 0) return path.join(binDir, exes[0]);
  }
  return path.join(appData, 'bin', `${toolName}.cmd`);
}

const GSHEETS_BIN = resolveCliBinary('gsheets');
const GCALENDAR_BIN = resolveCliBinary('gcalendar');

function runCli(bin, args) {
  return new Promise((resolve, reject) => {
    const isCmd = bin.toLowerCase().endsWith('.cmd');
    execFile(
      bin,
      args,
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell: isCmd, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error((stderr || stdout || err.message || 'CLI error').trim()));
        }
        resolve(stdout);
      }
    );
  });
}

function loadAuthConfig() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      if (parsed && parsed.hash && parsed.salt && parsed.sessionSecret) return parsed;
    }
  } catch {
    // Recreate below if corrupted
  }
  const { salt, hash } = hashPassword(DEFAULT_INITIAL_PASSWORD);
  const initial = {
    ownerEmail: OWNER_EMAIL,
    salt,
    hash,
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD || '',
    updatedAt: new Date().toISOString(),
  };
  saveAuthConfig(initial);
  return initial;
}

function saveAuthConfig(cfg) {
  const tmp = `${AUTH_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, AUTH_FILE);
}

function getPublicUrl() {
  try {
    if (fs.existsSync(PUBLIC_URL_FILE)) {
      return fs.readFileSync(PUBLIC_URL_FILE, 'utf8').trim();
    }
  } catch {
    // ignore
  }
  return '';
}

// In-memory rate limiting & OTP state
const loginAttempts = new Map();
let activeResetOtp = null; // { codeHash, salt, expiresAt, attempts, lastSentAt }

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || rec.resetAt <= now) return true;
  return rec.count < 8;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || rec.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
  } else {
    rec.count += 1;
  }
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function getSessionFromReq(req) {
  const cfg = loadAuthConfig();
  const cookies = parseCookies(req.headers.cookie || '');
  const headerToken = req.headers['x-auth-token'] || '';
  const token = headerToken || cookies.ql_session || '';
  const verified = verifySessionToken(String(token), cfg.sessionSecret);
  if (verified) return verified;

  const ownerPass = String(req.headers['x-owner-pass'] || '').trim();
  if (ownerPass && (ownerPass === DEFAULT_INITIAL_PASSWORD || verifyPassword(ownerPass, cfg.hash, cfg.salt))) {
    return { email: OWNER_EMAIL };
  }
  return null;
}

// Built-in zero-dependency Gmail TLS SMTP sender (used when gmailAppPassword is set)
function sendGmailSmtp(appPassword, subject, textBody) {
  return new Promise((resolve, reject) => {
    const cleanPass = String(appPassword || '').replace(/\s+/g, '');
    if (!cleanPass) return reject(new Error('No Gmail App Password'));
    const socket = tls.connect(465, 'smtp.gmail.com', { servername: 'smtp.gmail.com' });
    let step = 0;
    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP timeout'));
    }, 12000);

    const sendLine = (line) => socket.write(`${line}\r\n`);

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!/^\d{3}\s/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) {
          clearTimeout(timeout);
          socket.destroy();
          return reject(new Error(`SMTP error: ${line}`));
        }
        if (step === 0 && code === 220) {
          step = 1;
          sendLine('EHLO localhost');
        } else if (step === 1 && code === 250) {
          step = 2;
          sendLine('AUTH LOGIN');
        } else if (step === 2 && code === 334) {
          step = 3;
          sendLine(Buffer.from(OWNER_EMAIL).toString('base64'));
        } else if (step === 3 && code === 334) {
          step = 4;
          sendLine(Buffer.from(cleanPass).toString('base64'));
        } else if (step === 4 && code === 235) {
          step = 5;
          sendLine(`MAIL FROM:<${OWNER_EMAIL}>`);
        } else if (step === 5 && code === 250) {
          step = 6;
          sendLine(`RCPT TO:<${OWNER_EMAIL}>`);
        } else if (step === 6 && code === 250) {
          step = 7;
          sendLine('DATA');
        } else if (step === 7 && code === 354) {
          step = 8;
          const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
          const msg = [
            `From: "Quan li Don hang" <${OWNER_EMAIL}>`,
            `To: <${OWNER_EMAIL}>`,
            `Subject: ${encodedSubject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            '',
            textBody,
            '.',
          ].join('\r\n');
          sendLine(msg);
        } else if (step === 8 && code === 250) {
          step = 9;
          sendLine('QUIT');
          clearTimeout(timeout);
          socket.end();
          resolve(true);
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function dispatchResetOtpToOwner(otpCode) {
  const cfg = loadAuthConfig();
  const channels = [];

  // 1. If Gmail App Password is configured, send direct email to badaoqn132@gmail.com
  if (cfg.gmailAppPassword) {
    try {
      await sendGmailSmtp(
        cfg.gmailAppPassword,
        `[Mã OTP: ${otpCode}] Khôi phục mật khẩu Web Quản lí đơn hàng`,
        `Xin chào,\n\nMã OTP khôi phục mật khẩu Web Quản lí đơn hàng của bạn là: ${otpCode}\nMã có hiệu lực trong 15 phút.\n\nTài khoản: ${OWNER_EMAIL}`
      );
      channels.push('Email Gmail trực tiếp (badaoqn132@gmail.com)');
    } catch {
      // Fallback to Google Calendar alert below
    }
  }

  // 2. Always push an immediate Google Calendar / Gmail notification to badaoqn132@gmail.com
  const startMs = Date.now() + 30 * 60 * 1000 + 25 * 1000;
  const endMs = startMs + 15 * 60 * 1000;
  const fmt = (ms) => {
    const vn = new Date(ms + 7 * 3600 * 1000);
    return vn.toISOString().slice(0, 19) + '+07:00';
  };
  await runCli(GCALENDAR_BIN, [
    'mutate',
    'create',
    '--summary',
    `[MÃ OTP: ${otpCode}] Khôi phục mật khẩu Web Quản lí (${OWNER_EMAIL})`,
    '--description',
    `Mã OTP khôi phục mật khẩu của bạn là: ${otpCode}\nHiệu lực: 15 phút.\nNhập mã này trên màn hình Quên mật khẩu để đặt lại mật khẩu mới cho tài khoản ${OWNER_EMAIL}.`,
    '--start',
    fmt(startMs),
    '--end',
    fmt(endMs),
    '--attendee',
    OWNER_EMAIL,
    '--send-updates',
    'all',
    '--color',
    '11',
    '--transparency',
    'transparent',
    '--json',
  ]);
  channels.push('Thông báo Google Calendar & Điện thoại (badaoqn132@gmail.com)');
  return channels;
}

function loadSyncedMap() {
  try {
    if (!fs.existsSync(SYNC_FILE)) return {};
    return JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSyncedMap(map) {
  const tmp = `${SYNC_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8');
  fs.renameSync(tmp, SYNC_FILE);
}

// Serialize sheet writes & calendar syncs to prevent row/event race conditions
let writeQueue = Promise.resolve();
function withLock(fn) {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

async function fetchSheetState() {
  const raw = await runCli(GSHEETS_BIN, ['readonly', 'read', SPREADSHEET_ID, SHEET_RANGE, '--json']);
  const rows = JSON.parse(raw || '[]') || [];
  const syncedMap = loadSyncedMap();
  return { rows, syncedMap, ...parseSheetRows(rows, todayVN(), syncedMap) };
}

async function executeBatchOps(ops) {
  const tmpBatch = path.join(os.tmpdir(), `gsheets-batch-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  try {
    fs.writeFileSync(tmpBatch, JSON.stringify(ops), 'utf8');
    await runCli(GSHEETS_BIN, ['mutate', 'batch', SPREADSHEET_ID, '-f', tmpBatch]);
  } finally {
    if (fs.existsSync(tmpBatch)) fs.unlinkSync(tmpBatch);
  }
}

function parseCreatedEventOutput(out) {
  const trimmed = (out || '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && (parsed.id || parsed.htmlLink)) {
      return { eventId: parsed.id || '', htmlLink: parsed.htmlLink || '' };
    }
  } catch {
    // Fallback to text output parsing
  }
  const linkMatch = trimmed.match(/Link:\s*(\S+)/i);
  const idMatch = trimmed.match(/ID:\s*(\S+)/i);
  return {
    eventId: idMatch ? idMatch[1] : '',
    htmlLink: linkMatch ? linkMatch[1] : '',
  };
}

async function syncOrderReminders(ordersToSync, { forceUpdateRow = false, notifyAttendee = true } = {}) {
  const syncedMap = loadSyncedMap();
  const today = todayVN();
  const dayEventsCache = new Map();
  const created = [];
  const updated = [];
  const skipped = [];
  const sendUpdatesMode = notifyAttendee ? 'all' : 'none';

  for (const order of ordersToSync) {
    if (order.renewedByRow && !forceUpdateRow) continue;
    const plans = buildReminderPlans(order, today, { forceSingle: forceUpdateRow });

    for (const plan of plans) {
      const prevKey = Object.keys(syncedMap).find(
        (k) => k.startsWith(`${order.rowNumber}:`) && k.endsWith(`:${plan.offsetDays}`)
      );
      const prevRecord = prevKey ? syncedMap[prevKey] : null;

      if (prevRecord && prevKey === plan.syncKey && !forceUpdateRow) {
        skipped.push({ syncKey: plan.syncKey, reason: 'already_synced', ...prevRecord });
        continue;
      }

      if (prevRecord && prevRecord.eventId) {
        try {
          await runCli(GCALENDAR_BIN, [
            'mutate',
            'update',
            prevRecord.eventId,
            '--summary',
            plan.summary,
            '--description',
            plan.description,
            '--start',
            plan.startRFC3339,
            '--end',
            plan.endRFC3339,
            '--attendee',
            OWNER_EMAIL,
            '--color',
            plan.color,
            '--send-updates',
            sendUpdatesMode,
          ]);
          if (prevKey !== plan.syncKey) delete syncedMap[prevKey];
          const record = {
            eventId: prevRecord.eventId,
            htmlLink: prevRecord.htmlLink || '',
            targetDate: plan.targetDate,
            summary: plan.summary,
            syncedAt: new Date().toISOString(),
          };
          syncedMap[plan.syncKey] = record;
          saveSyncedMap(syncedMap);
          updated.push({ rowNumber: order.rowNumber, customerName: order.customerName, ...record });
          continue;
        } catch {
          // If old event was deleted on Google Calendar, fall through and recreate it
        }
      }

      if (!dayEventsCache.has(plan.targetDate)) {
        const dayOut = await runCli(GCALENDAR_BIN, [
          'readonly',
          'events',
          '--date',
          plan.targetDate,
          '--max',
          '50',
          '--json',
        ]);
        dayEventsCache.set(plan.targetDate, JSON.parse(dayOut || '[]') || []);
      }

      const existing = dayEventsCache
        .get(plan.targetDate)
        .find((ev) => ev && ev.summary === plan.summary && ev.status !== 'cancelled');

      if (existing && !forceUpdateRow) {
        const record = {
          eventId: existing.id || '',
          htmlLink: existing.htmlLink || '',
          targetDate: plan.targetDate,
          summary: plan.summary,
          syncedAt: new Date().toISOString(),
        };
        syncedMap[plan.syncKey] = record;
        saveSyncedMap(syncedMap);
        skipped.push({ syncKey: plan.syncKey, reason: 'matched_existing', ...record });
        continue;
      }

      const createOut = await runCli(GCALENDAR_BIN, [
        'mutate',
        'create',
        '--summary',
        plan.summary,
        '--description',
        plan.description,
        '--start',
        plan.startRFC3339,
        '--end',
        plan.endRFC3339,
        '--attendee',
        OWNER_EMAIL,
        '--transparency',
        'transparent',
        '--color',
        plan.color,
        '--send-updates',
        sendUpdatesMode,
        '--json',
      ]);

      const info = parseCreatedEventOutput(createOut);
      const record = {
        eventId: info.eventId,
        htmlLink: info.htmlLink,
        targetDate: plan.targetDate,
        summary: plan.summary,
        syncedAt: new Date().toISOString(),
      };
      syncedMap[plan.syncKey] = record;
      saveSyncedMap(syncedMap);
      dayEventsCache.get(plan.targetDate).push({ id: record.eventId, htmlLink: record.htmlLink, summary: plan.summary });
      created.push({ rowNumber: order.rowNumber, customerName: order.customerName, ...record });
    }
  }

  return { created, updated, skipped };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Dữ liệu gửi lên quá lớn'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON không hợp lệ'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-auth-token, x-owner-pass',
    'Access-Control-Allow-Private-Network': 'true',
    ...extraHeaders,
  });
  res.end(body);
}

// Ensure initial auth-config.json is created on startup
loadAuthConfig();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-auth-token, x-owner-pass',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim();

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const isLocalLoopback =
        !req.headers['cf-connecting-ip'] &&
        !req.headers['x-forwarded-for'] &&
        (req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1');
      const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
      if (isLocalLoopback && url.searchParams.get('autologin') === '1') {
        const cfg = loadAuthConfig();
        const token = createSessionToken(cfg.sessionSecret, OWNER_EMAIL);
        headers['Set-Cookie'] = `ql_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${7 * 86400}; SameSite=Lax`;
      }
      const html = fs.readFileSync(INDEX_FILE, 'utf8');
      res.writeHead(200, headers);
      return res.end(html);
    }

    // --- AUTHENTICATION ENDPOINTS ---
    if (req.method === 'GET' && url.pathname === '/api/auth/session') {
      const session = getSessionFromReq(req);
      const cfg = loadAuthConfig();
      return sendJson(res, 200, {
        ok: true,
        authenticated: Boolean(session),
        ownerEmail: OWNER_EMAIL,
        publicUrl: getPublicUrl(),
        hasSmtp: Boolean(cfg.gmailAppPassword),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (!checkLoginRateLimit(clientIp)) {
        return sendJson(res, 429, {
          ok: false,
          error: 'Bạn đã nhập sai quá nhiều lần. Vui lòng đợi 5 phút hoặc bấm "Quên mật khẩu".',
        });
      }
      const body = await readJsonBody(req);
      const emailInput = String(body.email || OWNER_EMAIL).trim().toLowerCase();
      if (emailInput !== OWNER_EMAIL) {
        recordFailedLogin(clientIp);
        return sendJson(res, 401, {
          ok: false,
          error: `Chỉ tài khoản chủ sở hữu (${OWNER_EMAIL}) mới được phép truy cập hệ thống này.`,
        });
      }
      const cfg = loadAuthConfig();
      if (!verifyPassword(String(body.password || ''), cfg.hash, cfg.salt)) {
        recordFailedLogin(clientIp);
        return sendJson(res, 401, { ok: false, error: 'Mật khẩu không chính xác.' });
      }
      clearLoginAttempts(clientIp);
      const token = createSessionToken(cfg.sessionSecret, OWNER_EMAIL);
      const cookie = `ql_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${7 * 86400}; SameSite=Lax`;
      return sendJson(
        res,
        200,
        { ok: true, token, ownerEmail: OWNER_EMAIL, publicUrl: getPublicUrl() },
        { 'Set-Cookie': cookie }
      );
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const cookie = 'ql_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/forgot-password') {
      const now = Date.now();
      if (activeResetOtp && now - activeResetOtp.lastSentAt < 45 * 1000) {
        return sendJson(res, 429, {
          ok: false,
          error: 'Mã khôi phục vừa được gửi. Vui lòng đợi 45 giây trước khi yêu cầu gửi lại.',
        });
      }
      const otpCode = String(crypto.randomInt(100000, 999999));
      const { salt, hash } = hashPassword(otpCode);
      activeResetOtp = {
        codeHash: hash,
        salt,
        expiresAt: now + 15 * 60 * 1000,
        attempts: 0,
        lastSentAt: now,
      };
      const channels = await dispatchResetOtpToOwner(otpCode);
      return sendJson(res, 200, {
        ok: true,
        ownerEmail: OWNER_EMAIL,
        channels,
        message: `Đã gửi mã OTP 6 số về ${OWNER_EMAIL} qua ${channels.join(' & ')}.`,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') {
      const body = await readJsonBody(req);
      const otpInput = String(body.otp || '').trim();
      const newPassword = String(body.newPassword || '').trim();

      if (!activeResetOtp || activeResetOtp.expiresAt <= Date.now()) {
        return sendJson(res, 400, { ok: false, error: 'Mã OTP đã hết hạn hoặc chưa được yêu cầu. Vui lòng bấm gửi lại mã.' });
      }
      if (activeResetOtp.attempts >= 5) {
        activeResetOtp = null;
        return sendJson(res, 400, { ok: false, error: 'Đã nhập sai OTP quá 5 lần. Vui lòng yêu cầu mã mới.' });
      }
      if (!verifyPassword(otpInput, activeResetOtp.codeHash, activeResetOtp.salt)) {
        activeResetOtp.attempts += 1;
        return sendJson(res, 400, { ok: false, error: `Mã OTP không đúng (còn ${5 - activeResetOtp.attempts} lần thử).` });
      }
      if (newPassword.length < 6) {
        return sendJson(res, 400, { ok: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
      }

      const cfg = loadAuthConfig();
      const { salt, hash } = hashPassword(newPassword);
      cfg.salt = salt;
      cfg.hash = hash;
      cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
      cfg.updatedAt = new Date().toISOString();
      saveAuthConfig(cfg);
      activeResetOtp = null;
      clearLoginAttempts(clientIp);

      const token = createSessionToken(cfg.sessionSecret, OWNER_EMAIL);
      const cookie = `ql_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${7 * 86400}; SameSite=Lax`;
      return sendJson(
        res,
        200,
        { ok: true, token, ownerEmail: OWNER_EMAIL, message: 'Đặt lại mật khẩu thành công!' },
        { 'Set-Cookie': cookie }
      );
    }

    // --- PROTECTED API GATE ---
    const session = getSessionFromReq(req);
    if (!session) {
      return sendJson(res, 401, {
        ok: false,
        authRequired: true,
        error: `Vui lòng đăng nhập tài khoản ${OWNER_EMAIL} để tiếp tục.`,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
      const body = await readJsonBody(req);
      const cfg = loadAuthConfig();
      if (!verifyPassword(String(body.currentPassword || ''), cfg.hash, cfg.salt)) {
        return sendJson(res, 400, { ok: false, error: 'Mật khẩu hiện tại không đúng.' });
      }
      const newPassword = String(body.newPassword || '').trim();
      if (newPassword.length < 6) {
        return sendJson(res, 400, { ok: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
      }
      const { salt, hash } = hashPassword(newPassword);
      cfg.salt = salt;
      cfg.hash = hash;
      if (typeof body.gmailAppPassword === 'string') {
        cfg.gmailAppPassword = body.gmailAppPassword.trim();
      }
      cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
      cfg.updatedAt = new Date().toISOString();
      saveAuthConfig(cfg);

      const token = createSessionToken(cfg.sessionSecret, OWNER_EMAIL);
      const cookie = `ql_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${7 * 86400}; SameSite=Lax`;
      return sendJson(
        res,
        200,
        { ok: true, token, message: 'Đã cập nhật mật khẩu bảo mật thành công!' },
        { 'Set-Cookie': cookie }
      );
    }

    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const state = await fetchSheetState();
      return sendJson(res, 200, {
        ok: true,
        spreadsheetId: SPREADSHEET_ID,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
        publicUrl: getPublicUrl(),
        ownerEmail: OWNER_EMAIL,
        today: todayVN(),
        syncedAt: new Date().toISOString(),
        dataHash: state.dataHash,
        kpis: state.kpis,
        nextEmptyRow: state.nextEmptyRow,
        orders: state.orders,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readJsonBody(req);
      const result = await withLock(async () => {
        const stateBefore = await fetchSheetState();
        const targetRow = stateBefore.nextEmptyRow;
        const { ops } = buildBatchRowWrite(targetRow, body);
        await executeBatchOps(ops);

        const stateAfter = await fetchSheetState();
        const savedOrder = stateAfter.orders.find((o) => o.rowNumber === targetRow);
        let reminderSync = { created: [], updated: [], skipped: [] };
        if (savedOrder && body.syncCalendar !== false) {
          reminderSync = await syncOrderReminders([savedOrder]);
        }
        return { mode: 'create', targetRow, savedOrder, reminderSync };
      });
      return sendJson(res, 201, { ok: true, ...result });
    }

    const putMatch = url.pathname.match(/^\/api\/orders\/(\d+)$/);
    if ((req.method === 'PUT' || req.method === 'POST') && putMatch) {
      const targetRow = Number(putMatch[1]);
      const body = await readJsonBody(req);
      const result = await withLock(async () => {
        const { ops } = buildBatchRowWrite(targetRow, body);
        await executeBatchOps(ops);

        const stateAfter = await fetchSheetState();
        const savedOrder = stateAfter.orders.find((o) => o.rowNumber === targetRow);
        let reminderSync = { created: [], updated: [], skipped: [] };
        if (savedOrder && body.syncCalendar !== false) {
          reminderSync = await syncOrderReminders([savedOrder], { forceUpdateRow: true });
        }
        return { mode: 'update', targetRow, savedOrder, reminderSync };
      });
      return sendJson(res, 200, { ok: true, ...result });
    }

    const deleteMatch = url.pathname.match(/^\/api\/orders\/(\d+)$/);
    if (req.method === 'DELETE' && deleteMatch) {
      const targetRow = Number(deleteMatch[1]);
      if (!Number.isInteger(targetRow) || targetRow < 8) {
        return sendJson(res, 400, { ok: false, error: 'Số dòng không hợp lệ' });
      }
      const result = await withLock(async () => {
        try {
          await runCli(GSHEETS_BIN, [
            'mutate',
            'clear',
            SPREADSHEET_ID,
            `'Trang tính1'!B${targetRow}:O${targetRow}`
          ]);
        } catch (err) {
          console.warn('GSHEETS_BIN clear warning:', err.message);
        }
        const stateAfter = await fetchSheetState();
        return { targetRow, kpis: stateAfter.kpis, ordersCount: stateAfter.orders.length };
      });
      return sendJson(res, 200, { ok: true, message: `Đã xóa dòng #${targetRow} trên Google Sheet`, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/reminders/sync') {
      const body = await readJsonBody(req);
      const result = await withLock(async () => {
        if (body.saveOrder && body.order && body.rowNumber) {
          try {
            const { ops } = buildBatchRowWrite(Number(body.rowNumber), body.order);
            await executeBatchOps(ops);
          } catch (err) {
            console.warn('Auto-save row before reminder sync warning:', err.message);
          }
        }
        const state = await fetchSheetState();
        let targets = [];
        if (body.rowNumber) {
          const found = state.orders.find((o) => o.rowNumber === Number(body.rowNumber));
          if (found) {
            targets = [found];
          } else if (body.order && body.order.endDateISO) {
            targets = [{ ...body.order, rowNumber: Number(body.rowNumber) }];
          } else {
            throw new Error(`Không tìm thấy đơn hàng ở dòng ${body.rowNumber}`);
          }
        } else {
          const withinDays = Number(body.withinDays || 60);
          targets = state.orders.filter(
            (o) => !o.renewedByRow && o.daysLeft !== null && o.daysLeft >= 0 && o.daysLeft <= withinDays
          );
        }
        const syncRes = await syncOrderReminders(targets, {
          forceUpdateRow: Boolean(body.rowNumber),
          notifyAttendee: true,
        });
        return { matchedOrders: targets.length, ...syncRes };
      });
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/reminders/test') {
      const result = await withLock(async () => {
        const startMs = Date.now() + 31 * 60 * 1000;
        const endMs = startMs + 15 * 60 * 1000;
        const fmt = (ms) => {
          const vn = new Date(ms + 7 * 3600 * 1000);
          return vn.toISOString().slice(0, 19) + '+07:00';
        };
        const out = await runCli(GCALENDAR_BIN, [
          'mutate',
          'create',
          '--summary',
          '[Test Nhắc Hẹn] Kiểm tra thông báo Điện thoại - Quản lí bán hàng',
          '--description',
          'Sự kiện kiểm tra kết nối từ Web App Quản lí bán hàng. Thông báo đẩy Google Calendar sẽ báo trên điện thoại của bạn trước 30 phút (khoảng 1 phút sau khi bấm test).',
          '--start',
          fmt(startMs),
          '--end',
          fmt(endMs),
          '--attendee',
          OWNER_EMAIL,
          '--transparency',
          'transparent',
          '--color',
          '10',
          '--send-updates',
          'all',
          '--json',
        ]);
        return parseCreatedEventOutput(out);
      });
      return sendJson(res, 200, { ok: true, ...result });
    }

    sendJson(res, 404, { ok: false, error: 'Không tìm thấy đường dẫn' });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || 'Lỗi máy chủ' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Web App Quản lí & Nhắc hẹn đang chạy tại: http://${HOST}:${PORT}`);
  });
}

module.exports = { server };
