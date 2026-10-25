'use strict';

const assert = require('node:assert/strict');
const {
  isoToSerialDate,
  parseSheetDate,
  addDaysISO,
  diffDaysISO,
  parseSheetRows,
  buildBatchRowWrite,
  buildReminderPlans,
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
} = require('./lib');

// 1. Exact Google Sheets serial numbers verified against Trang tính1!I8 & K8
assert.equal(isoToSerialDate('2026-08-24'), '46258');
assert.equal(isoToSerialDate('2026-11-24'), '46350');
assert.throws(() => isoToSerialDate('2026-02-30'), /Ngày không hợp lệ/);

// 2. Date parsing & 3-day reminder offset
assert.equal(parseSheetDate('03-11-2026'), '2026-11-03');
assert.equal(parseSheetDate('2026-11-03'), '2026-11-03');
assert.equal(addDaysISO('2026-11-03', -3), '2026-10-31');
assert.equal(diffDaysISO('2026-11-03', '2026-10-24'), 10);

// 3. Sheet row parsing, nextEmptyRow detection (ignoring pre-filled K formulas), and renewal detection
const sampleRows = [
  [],
  ['', '', '', 'BẢNG THEO DÕI BÁN HÀNG ONLINE'],
  [],
  ['', '', '', 'Tổng doanh thu', '', 'Tổng đơn hàng', '', 'Tổng chi phí', '', 'Lợi nhuận'],
  ['', '', '', '67.165', '', '134', '', '6.140', '', '61.025'],
  [],
  ['', 'STT', 'Tên Khách Hàng', 'Mặt Hàng', 'SĐT', 'Kênh Mua', 'Giá Bán', 'Giá Nhập', 'Ngày Mua', 'Thời Hạn (Tháng)', 'Ngày Kết Thúc'],
  ['', '1', 'anh beck', 'capcut', '', 'Facebook', '60', '', '04-09-2026', '1', '04-10-2026'],
  ['', '', '', '', '', '', '', '', '', '', ''], // empty row 9 (even if K9 has formula in sheet)
  ['', '2', 'beck', 'capcut', '', 'Facebook', '60', '', '03-10-2026', '1', '03-11-2026'],
];
const parsed = parseSheetRows(sampleRows, '2026-10-24', {});
assert.equal(parsed.nextEmptyRow, 9);
assert.equal(parsed.orders.length, 2);
assert.equal(parsed.orders[0].renewedByRow, 10);
assert.equal(parsed.orders[1].daysLeft, 10);

// 4. Safe batch row write (preserves Col B, writes EDATE formula in Col K, protects leading 0 & formula injection)
const batch = buildBatchRowWrite(142, {
  customerName: '=Hack',
  product: 'gemini',
  phone: '0908793997',
  channel: 'Zalo',
  salePrice: '1.250',
  costPrice: '',
  buyDate: '2026-10-24',
  months: '18',
  note: '6 tháng nhắc/lần',
});
assert.equal(batch.ops[0].range, "'Trang tính1'!C142:O142");
assert.equal(batch.ops[0].data[0][0], "'=Hack");
assert.equal(batch.ops[0].data[0][2], "'0908793997");
assert.equal(batch.ops[0].data[0][4], '1250');
assert.equal(
  batch.ops[0].data[0][8],
  '=IF(AND(ISNUMBER(I142); ISNUMBER(J142)); EDATE(I142; J142); "")'
);

// 5. Reminder plan generation (-3 days and 0 day, skipping past dates)
const plansBoth = buildReminderPlans(parsed.orders[1], '2026-10-24');
assert.equal(plansBoth.length, 2);
assert.equal(plansBoth[0].targetDate, '2026-10-31');
assert.equal(plansBoth[1].targetDate, '2026-11-03');

const plansOnlyEnd = buildReminderPlans(parsed.orders[1], '2026-11-01');
assert.equal(plansOnlyEnd.length, 1);
assert.equal(plansOnlyEnd[0].targetDate, '2026-11-03');

// 6. Password hashing & signed session tokens
const { salt, hash } = hashPassword('badao132');
assert.equal(verifyPassword('badao132', hash, salt), true);
assert.equal(verifyPassword('wrongpass', hash, salt), false);

const secret = 'test-secret-key';
const token = createSessionToken(secret, 'badaoqn132@gmail.com', 1000, 5000);
assert.equal(verifySessionToken(token, secret, 3000).email, 'badaoqn132@gmail.com');
assert.equal(verifySessionToken(token, secret, 7000), null);
assert.equal(verifySessionToken(token, 'wrong-secret', 3000), null);

console.log('ALL TESTS PASSED');
