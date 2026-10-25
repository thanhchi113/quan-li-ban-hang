'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLOUDFLARED = path.join(__dirname, 'cloudflared.exe');
const PUBLIC_URL_FILE = path.join(__dirname, 'public-url.txt');
const TARGET = process.env.TUNNEL_TARGET || 'http://127.0.0.1:3456';

if (!fs.existsSync(CLOUDFLARED)) {
  console.error('Không tìm thấy cloudflared.exe');
  process.exit(1);
}

const proc = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', TARGET], {
  windowsHide: true,
});

function handleChunk(chunk) {
  const text = chunk.toString('utf8');
  process.stdout.write(text);
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (m) {
    fs.writeFileSync(PUBLIC_URL_FILE, m[0], 'utf8');
    console.log(`\n========================================`);
    console.log(`PUBLIC WEB URL: ${m[0]}`);
    console.log(`========================================\n`);
  }
}

proc.stdout.on('data', handleChunk);
proc.stderr.on('data', handleChunk);
proc.on('exit', (code) => {
  process.exit(code || 0);
});
