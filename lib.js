'use strict';

const crypto = require('node:crypto');

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;
const ALLOWED_CHANNELS = new Set(['', 'Zalo', 'Facebook']);

function todayVN(now = new Date()) {
  const vn = new Date(now.getTime() + 7 * 3600 * 1000);
  return vn.toISOString().slice(0, 10);
}

function parseISODateParts(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d, utc };
}

function isoToSerialDate(iso) {
  const parts = parseISODateParts(iso);
  if (!parts) throw new Error(`Ngày không hợp lệ: ${iso}`);
  return String(Math.round((parts.utc - EXCEL_EPOCH_UTC) / MS_PER_DAY));
}

function formatISOToVN(iso) {
  const parts = parseISODateParts(iso);
  if (!parts) return iso || '';
  return `${String(parts.d).padStart(2, '0')}-${String(parts.m).padStart(2, '0')}-${parts.y}`;
}

function parseSheetDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return parseISODateParts(iso) ? iso : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && parseISODateParts(s)) return s;
  return null;
}

function addDaysISO(iso, days) {
  const parts = parseISODateParts(iso);
  if (!parts) throw new Error(`Ngày không hợp lệ: ${iso}`);
  return new Date(parts.utc + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function diffDaysISO(targetISO, baseISO) {
  const t = parseISODateParts(targetISO);
  const b = parseISODateParts(baseISO);
  if (!t || !b) return null;
  return Math.round((t.utc - b.utc) / MS_PER_DAY);
}

function addMonthsEstimateISO(buyISO, months) {
  const parts = parseISODateParts(buyISO);
  if (!parts || !Number.isFinite(months)) return null;
  const totalMonths = (parts.y * 12 + (parts.m - 1)) + months;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1;
  const maxDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(parts.d, maxDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function sanitizeText(val) {
  const s = String(val ?? '').trim();
  // Prevent spreadsheet formula injection on user text fields
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

function cleanPrice(val, fieldName) {
  const s = String(val ?? '').trim();
  if (!s) return '';
  const digits = s.replace(/[.\s,]/g, '');
  if (!/^\d+$/.test(digits)) throw new Error(`${fieldName} phải là số nguyên (ví dụ: 700 hoặc 1250)`);
  return String(Number(digits));
}

function normalizeCustomerKey(order) {
  const item = (order.product || '').trim().toLowerCase();
  const id =
    (order.customerEmail || '').trim().toLowerCase() ||
    (order.phone || '').replace(/\D/g, '') ||
    (order.customerName || '').trim().toLowerCase().replace(/^anh\s+|^chị\s+|^cô\s+|^thầy\s+/i, '');
  return id && item ? `${id}|${item}` : '';
}

function parseSheetRows(rows, todayISO = todayVN(), syncedMap = {}) {
  const kpiRow = rows[4] || [];
  const kpis = {
    revenue: kpiRow[3] || '0',
    totalOrders: kpiRow[5] || '0',
    totalCost: kpiRow[7] || '0',
    profit: kpiRow[9] || '0',
  };

  let nextEmptyRow = Math.max(8, rows.length + 1);
  const orders = [];

  for (let i = 7; i < rows.length; i++) {
    const r = rows[i] || [];
    const rowNumber = i + 1;
    const customerName = String(r[2] ?? '').trim();
    if (!customerName) {
      if (rowNumber < nextEmptyRow) nextEmptyRow = rowNumber;
      continue;
    }
    const buyDateRaw = String(r[8] ?? '').trim();
    const buyDateISO = parseSheetDate(buyDateRaw);
    const endDateRaw = String(r[10] ?? '').trim();
    const endDateISO = parseSheetDate(endDateRaw);
    const daysLeft = endDateISO ? diffDaysISO(endDateISO, todayISO) : null;
    const syncBase = `${rowNumber}:${endDateISO || ''}`;

    orders.push({
      rowNumber,
      stt: String(r[1] ?? '').trim(),
      customerName,
      product: String(r[3] ?? '').trim(),
      phone: String(r[4] ?? '').trim(),
      channel: String(r[5] ?? '').trim(),
      salePrice: String(r[6] ?? '').trim(),
      costPrice: String(r[7] ?? '').trim(),
      buyDate: buyDateRaw,
      buyDateISO,
      months: String(r[9] ?? '').trim(),
      endDate: endDateRaw,
      endDateISO,
      daysLeft,
      source: String(r[11] ?? '').trim(),
      customerEmail: String(r[12] ?? '').trim(),
      famEmail: String(r[13] ?? '').trim(),
      note: String(r[14] ?? '').trim(),
      syncedBefore3d: syncedMap[`${syncBase}:3`] || null,
      syncedOnDay: syncedMap[`${syncBase}:0`] || null,
    });
  }

  // Mark expired orders that already have a newer active renewal row
  const activeByKey = new Map();
  for (const o of orders) {
    if (o.daysLeft !== null && o.daysLeft >= 0) {
      const k = normalizeCustomerKey(o);
      if (k) activeByKey.set(k, o.rowNumber);
    }
  }
  for (const o of orders) {
    if (o.daysLeft !== null && o.daysLeft < 0) {
      const k = normalizeCustomerKey(o);
      const newer = k ? activeByKey.get(k) : null;
      if (newer && newer !== o.rowNumber) o.renewedByRow = newer;
    }
  }

  const dataHash = crypto
    .createHash('sha1')
    .update(JSON.stringify({ kpis, orders }))
    .digest('hex')
    .slice(0, 12);

  return { kpis, nextEmptyRow, orders, dataHash };
}

function buildBatchRowWrite(rowNumber, input) {
  if (!Number.isInteger(rowNumber) || rowNumber < 8) {
    throw new Error('Số dòng ghi vào Sheet không hợp lệ');
  }
  const customerName = sanitizeText(input.customerName);
  if (!customerName) throw new Error('Vui lòng nhập Tên Khách Hàng');

  const product = sanitizeText(input.product);
  if (!product) throw new Error('Vui lòng nhập Mặt Hàng / Nội dung cần nhắc');

  const channel = sanitizeText(input.channel ?? 'Zalo') || 'Zalo';

  const buyDateISO = String(input.buyDate ?? '').trim();
  if (!parseISODateParts(buyDateISO)) throw new Error('Ngày Mua không hợp lệ (YYYY-MM-DD)');

  const monthsStr = String(input.months ?? '').trim();
  const customEndISO = String(input.customEndDate ?? '').trim();
  let monthsCell = '';
  // shortcut: rows > 500 show raw serial until formatted, extend sheet formatting at 500 rows
  let endFormulaOrSerial = '';
  let resolvedEndISO = null;

  const dayMatch = monthsStr.match(/^(\d+)\s*(ngày|ngay|n|d)\b/i);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    monthsCell = `${days} ngày`;
    resolvedEndISO = customEndISO || addDaysISO(buyDateISO, days);
    endFormulaOrSerial = isoToSerialDate(resolvedEndISO);
  } else if (monthsStr !== '') {
    const months = Number(monthsStr);
    if (!Number.isInteger(months) || months <= 0 || months > 240) {
      throw new Error('Thời Hạn (Tháng) phải là số nguyên dương (1 - 240)');
    }
    monthsCell = String(months);
    endFormulaOrSerial = `=IF(AND(ISNUMBER(I${rowNumber}); ISNUMBER(J${rowNumber})); EDATE(I${rowNumber}; J${rowNumber}); "")`;
    resolvedEndISO = addMonthsEstimateISO(buyDateISO, months);
  } else if (customEndISO !== '') {
    endFormulaOrSerial = isoToSerialDate(customEndISO);
    resolvedEndISO = customEndISO;
  } else {
    throw new Error('Vui lòng nhập Thời Hạn hoặc chọn Ngày Kết Thúc / Ngày Hẹn Nhắc');
  }

  const rawPhone = String(input.phone ?? '').trim();
  const phoneCell = rawPhone ? (/^[0+=]/.test(rawPhone) ? `'${rawPhone}` : sanitizeText(rawPhone)) : '';

  const rowValues = [
    customerName,
    product,
    phoneCell,
    channel,
    cleanPrice(input.salePrice, 'Giá Bán'),
    cleanPrice(input.costPrice, 'Giá Nhập'),
    isoToSerialDate(buyDateISO),
    monthsCell,
    endFormulaOrSerial,
    sanitizeText(input.source),
    sanitizeText(input.customerEmail),
    sanitizeText(input.famEmail),
    sanitizeText(input.note),
  ];

  return {
    ops: [{ op: 'write', range: `'Trang tính1'!C${rowNumber}:O${rowNumber}`, data: [rowValues] }],
    resolvedEndISO,
  };
}

function buildReminderPlans(order, todayISO = todayVN(), { forceSingle = false } = {}) {
  if (!order.endDateISO) return [];
  const plans = [];
  for (const offsetDays of [3, 0]) {
    const targetDate = addDaysISO(order.endDateISO, -offsetDays);
    if (!forceSingle && diffDaysISO(targetDate, todayISO) < 0) continue;
    const syncKey = `${order.rowNumber}:${order.endDateISO}:${offsetDays}`;
    const prefix = offsetDays === 3 ? '[Còn 3 ngày]' : '[HẾT HẠN HÔM NAY]';
    const summary = `${prefix} ${order.customerName} - ${order.product}`;
    const lines = [
      `Đơn hàng #${order.stt || order.rowNumber - 7} (Dòng ${order.rowNumber})`,
      `Khách hàng: ${order.customerName}`,
      `Mặt hàng: ${order.product}`,
      `Ngày kết thúc: ${formatISOToVN(order.endDateISO)}`,
      order.channel ? `Kênh mua: ${order.channel}` : '',
      order.phone ? `SĐT: ${order.phone}` : '',
      order.salePrice ? `Giá bán: ${order.salePrice}k` : '',
      order.customerEmail ? `Mail khách: ${order.customerEmail}` : '',
      order.famEmail ? `Mail Fam: ${order.famEmail}` : '',
      order.note ? `Lưu ý: ${order.note}` : '',
      `Google Sheet: https://docs.google.com/spreadsheets/d/1t1WTrgrfVv_WbUG-Zl2ORwwjGWzgV0XodD9WnNvp8ZE/edit#gid=0&range=C${order.rowNumber}`,
    ].filter(Boolean);

    plans.push({
      syncKey,
      offsetDays,
      targetDate,
      startRFC3339: `${targetDate}T08:00:00+07:00`,
      endRFC3339: `${targetDate}T08:30:00+07:00`,
      color: offsetDays === 3 ? '5' : '11',
      summary,
      description: lines.join('\n'),
    });
  }
  return plans;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, hash, salt) {
  if (!password || !hash || !salt) return false;
  const computed = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}

function createSessionToken(secret, email, nowMs = Date.now(), ttlMs = 7 * MS_PER_DAY) {
  const payload = Buffer.from(JSON.stringify({ email, exp: nowMs + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token, secret, nowMs = Date.now()) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.exp !== 'number' || data.exp <= nowMs) return null;
    return data;
  } catch {
    return null;
  }
}

module.exports = {
  todayVN,
  isoToSerialDate,
  formatISOToVN,
  parseSheetDate,
  addDaysISO,
  diffDaysISO,
  addMonthsEstimateISO,
  parseSheetRows,
  buildBatchRowWrite,
  buildReminderPlans,
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
};
