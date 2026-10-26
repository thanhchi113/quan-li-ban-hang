/**
 * =========================================================================
 * GOOGLE APPS SCRIPT - BACKEND ĐỒNG BỘ 2 CHIỀU CHO WEB QUẢN LÝ BÁN HÀNG
 * Tác giả: Thanh Chí
 * =========================================================================
 * Hướng dẫn cài đặt trong 1 phút:
 * 1. Mở Google Sheet "BẢNG THEO DÕI BÁN HÀNG ONLINE" của bạn.
 * 2. Chọn menu Tiện ích mở rộng (Extensions) -> Apps Script.
 * 3. Xóa code cũ, dán toàn bộ nội dung file này vào.
 * 4. Bấm biểu tượng Đĩa mềm (Lưu) -> Chọn hàm "doGet" rồi bấm "Chạy" (Run) 1 lần để cấp quyền truy cập.
 * 5. Bấm nút "Triển khai" (Deploy) ở góc trên bên phải -> "Tùy chọn triển khai mới" (New deployment).
 *    - Chọn loại: "Ứng dụng web" (Web app)
 *    - Mô tả: "Backend Quan Ly Ban Hang"
 *    - Thực thi dưới dạng (Execute as): "Tôi" (Me)
 *    - Ai có quyền truy cập (Who has access): "Bất kỳ ai" (Anyone)
 * 6. Bấm "Triển khai" (Deploy), sao chép URL Ứng dụng web (kết thúc bằng /exec).
 * 7. Mở Web App trên GitHub Pages -> Bấm "Web & Bảo mật" -> Dán URL vào ô "Google Apps Script Web App URL" và bấm Lưu.
 * =========================================================================
 */

const SHEET_NAME = 'Trang tính1';

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'read';
    if (action === 'read' || action === 'getAll') {
      const data = readSheetData();
      return jsonResponse({ ok: true, ...data });
    }
    return jsonResponse({ ok: false, error: 'Hành động không hợp lệ: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
    const action = payload.action || 'read';

    if (action === 'read' || action === 'getAll') {
      const data = readSheetData();
      return jsonResponse({ ok: true, ...data });
    }

    if (action === 'create') {
      const order = payload.order || payload;
      const result = createOrder(order);
      return jsonResponse({ ok: true, ...result });
    }

    if (action === 'update') {
      const rowNumber = Number(payload.rowNumber);
      const order = payload.order || payload;
      const result = updateOrder(rowNumber, order);
      return jsonResponse({ ok: true, ...result });
    }

    if (action === 'delete') {
      const rowNumber = Number(payload.rowNumber);
      const result = deleteOrder(rowNumber);
      return jsonResponse({ ok: true, ...result });
    }

    if (action === 'syncReminders') {
      const orders = Array.isArray(payload.orders) ? payload.orders : [];
      const result = syncCalendarReminders(orders);
      return jsonResponse({ ok: true, ...result });
    }

    if (action === 'testReminder') {
      const result = createTestPhoneReminder();
      return jsonResponse({ ok: true, ...result });
    }

    return jsonResponse({ ok: false, error: 'Hành động không hỗ trợ: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function readSheetData() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  const lastRow = Math.max(sheet.getLastRow(), 50);
  const range = sheet.getRange(1, 1, lastRow, 15);
  const values = range.getValues();
  const displayValues = range.getDisplayValues();

  // Đọc KPI từ dòng 5 (dòng 5: C, E, G, I hoặc D, F, H, J)
  const totalRevenue = displayValues[4] ? (displayValues[4][3] || displayValues[4][2] || '') : '';
  const totalOrders = displayValues[4] ? (displayValues[4][5] || displayValues[4][4] || '') : '';
  const totalCost = displayValues[4] ? (displayValues[4][7] || displayValues[4][6] || '') : '';
  const profit = displayValues[4] ? (displayValues[4][9] || displayValues[4][8] || '') : '';

  const orders = [];
  let nextEmptyRow = 8;
  const todayISO = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');

  for (let i = 7; i < values.length; i++) {
    const rowNum = i + 1;
    const r = values[i];
    const d = displayValues[i];

    const customerName = String(d[2] || '').trim();
    const product = String(d[3] || '').trim();

    // Bỏ qua dòng trống
    if (!customerName && !product) {
      if (nextEmptyRow === 8) nextEmptyRow = rowNum;
      continue;
    }

    const buyDateRaw = String(d[8] || '').trim();
    const buyDateISO = formatDateISO(r[8], d[8]);
    const endDateRaw = String(d[10] || '').trim();
    const endDateISO = formatDateISO(r[10], d[10]);
    const daysLeft = endDateISO ? diffDays(endDateISO, todayISO) : null;

    orders.push({
      rowNumber: rowNum,
      stt: String(d[1] || orders.length + 1),
      customerName: customerName,
      product: product,
      phone: String(d[4] || '').trim(),
      channel: String(d[5] || '').trim(),
      salePrice: String(d[6] || '').trim(),
      costPrice: String(d[7] || '').trim(),
      buyDate: buyDateRaw || buyDateISO,
      buyDateISO: buyDateISO,
      months: String(d[9] || '1').trim(),
      endDate: endDateRaw || endDateISO,
      endDateISO: endDateISO,
      daysLeft: daysLeft,
      source: String(d[11] || '').trim(),
      customerEmail: String(d[12] || '').trim(),
      famEmail: String(d[13] || '').trim(),
      note: String(d[14] || '').trim(),
      syncedBefore3d: null,
      syncedOnDay: null
    });

    nextEmptyRow = rowNum + 1;
  }

  // Tự động phát hiện đơn đã nối gói
  const activeByKey = {};
  for (let j = 0; j < orders.length; j++) {
    const o = orders[j];
    if (o.daysLeft !== null && o.daysLeft >= 0) {
      const k = normalizeKey(o);
      if (k) activeByKey[k] = o.rowNumber;
    }
  }
  for (let j = 0; j < orders.length; j++) {
    const o = orders[j];
    if (o.daysLeft !== null && o.daysLeft < 0) {
      const k = normalizeKey(o);
      const newer = k ? activeByKey[k] : null;
      if (newer && newer !== o.rowNumber) o.renewedByRow = newer;
    }
  }

  return {
    orders: orders,
    kpis: {
      revenue: totalRevenue,
      totalOrders: totalOrders || String(orders.length),
      totalCost: totalCost,
      profit: profit
    },
    today: todayISO,
    nextEmptyRow: nextEmptyRow,
    syncedAt: new Date().toISOString()
  };
}

function normalizeKey(o) {
  const item = (o.product || '').trim().toLowerCase();
  const id = (o.phone || '').replace(/\D/g, '') || (o.customerEmail || '').trim().toLowerCase() || (o.customerName || '').trim().toLowerCase();
  return id && item ? id + '|' + item : '';
}

function diffDays(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const pA = isoA.split('-').map(Number);
  const pB = isoB.split('-').map(Number);
  const utcA = Date.UTC(pA[0], pA[1] - 1, pA[2]);
  const utcB = Date.UTC(pB[0], pB[1] - 1, pB[2]);
  return Math.round((utcA - utcB) / 86400000);
}

function createOrder(order) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(8, 3, Math.max(lastRow - 7, 1), 2).getValues();

  let targetRow = 8;
  for (let i = 0; i < values.length; i++) {
    const c = String(values[i][0] || '').trim();
    const p = String(values[i][1] || '').trim();
    if (!c && !p) {
      targetRow = 8 + i;
      break;
    }
    targetRow = 8 + i + 1;
  }

  const endFormula = order.customEndDate ? formatDateVN(order.customEndDate) : `=EDATE(I${targetRow},J${targetRow})`;

  const rowData = [
    order.customerName || '',
    order.product || '',
    order.phone ? "'" + order.phone : '',
    order.channel || 'Zalo',
    order.salePrice || '',
    order.costPrice || '',
    formatDateVN(order.buyDate),
    order.months || '1',
    endFormula,
    order.source || '',
    order.customerEmail || '',
    order.famEmail || '',
    order.note || ''
  ];

  sheet.getRange(targetRow, 3, 1, rowData.length).setValues([rowData]);

  return { targetRow: targetRow, message: 'Đã thêm đơn hàng thành công!' };
}

function updateOrder(rowNumber, order) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  const endFormula = order.customEndDate ? formatDateVN(order.customEndDate) : `=EDATE(I${rowNumber},J${rowNumber})`;

  const rowData = [
    order.customerName || '',
    order.product || '',
    order.phone ? "'" + order.phone : '',
    order.channel || 'Zalo',
    order.salePrice || '',
    order.costPrice || '',
    formatDateVN(order.buyDate),
    order.months || '1',
    endFormula,
    order.source || '',
    order.customerEmail || '',
    order.famEmail || '',
    order.note || ''
  ];

  sheet.getRange(rowNumber, 3, 1, rowData.length).setValues([rowData]);

  return { rowNumber: rowNumber, message: 'Đã cập nhật đơn hàng thành công!' };
}

function deleteOrder(rowNumber) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (rowNumber && rowNumber >= 8) {
    sheet.getRange(rowNumber, 2, 1, 14).clearContent();
  }
  return { rowNumber: rowNumber, message: 'Đã xóa đơn hàng trên Google Sheet thành công!' };
}

function formatDateISO(val, disp) {
  if (val instanceof Date && !isNaN(val)) {
    return Utilities.formatDate(val, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  }
  const str = String(disp || val || '').trim();
  const parts = str.split(/[-\/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return str;
}

function formatDateVN(iso) {
  if (!iso) return '';
  const parts = String(iso).split(/[-\/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return `${parts[0]}-${parts[1]}-${parts[2]}`;
  }
  return iso;
}

function syncCalendarReminders(orders) {
  const cal = CalendarApp.getDefaultCalendar();
  const created = [];
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (!o || !o.endDateISO) continue;
    const offsets = [3, 0];
    for (let j = 0; j < offsets.length; j++) {
      const off = offsets[j];
      const p = o.endDateISO.split('-').map(Number);
      const startDt = new Date(p[0], p[1] - 1, p[2] - off, 8, 0, 0);
      const endDt = new Date(p[0], p[1] - 1, p[2] - off, 8, 30, 0);
      const prefix = off === 3 ? '[Còn 3 ngày]' : '[HẾT HẠN HÔM NAY]';
      const title = prefix + ' ' + (o.customerName || '') + ' - ' + (o.product || '');
      const desc = [
        'Khách hàng: ' + (o.customerName || ''),
        'Mặt hàng: ' + (o.product || ''),
        'Ngày hết hạn: ' + (o.endDate || o.endDateISO),
        o.phone ? 'SĐT: ' + o.phone : '',
        o.channel ? 'Kênh: ' + o.channel : '',
        o.note ? 'Ghi chú: ' + o.note : ''
      ].filter(Boolean).join('\n');
      const ev = cal.createEvent(title, startDt, endDt, { description: desc });
      ev.removeAllReminders();
      ev.addPopupReminder(30);
      ev.addPopupReminder(0);
      ev.addEmailReminder(30);
      created.push({ rowNumber: o.rowNumber, offsetDays: off, eventId: ev.getId() });
    }
  }
  return { createdCount: created.length, created: created };
}

function createTestPhoneReminder() {
  const cal = CalendarApp.getDefaultCalendar();
  const startDt = new Date(Date.now() + 2 * 60 * 1000);
  const endDt = new Date(startDt.getTime() + 15 * 60 * 1000);
  const ev = cal.createEvent(
    '[Test Nhắc Hẹn] Kiểm tra thông báo Điện thoại - Quản lí bán hàng',
    startDt,
    endDt,
    { description: 'Sự kiện kiểm tra kết nối từ Web App Quản lí bán hàng.' }
  );
  ev.removeAllReminders();
  ev.addPopupReminder(1);
  ev.addEmailReminder(1);
  return { eventId: ev.getId(), message: 'Đã tạo lịch nhắc thử trên Google Calendar!' };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
