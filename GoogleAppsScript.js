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
 * 7. Mở Web App trên GitHub Pages -> Bấm "Web & Bảo mật" (hoặc "Đồng bộ Sheet") -> Dán URL vào ô "Google Apps Script Web App URL" và bấm Lưu.
 * =========================================================================
 */

const SHEET_NAME = 'Trang tính1';

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'read';
    if (action === 'read') {
      const data = readSheetData();
      return jsonResponse({ ok: true, ...data });
    }
    return jsonResponse({ ok: false, error: 'Hành động không hợp lệ' });
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

    if (action === 'read') {
      const data = readSheetData();
      return jsonResponse({ ok: true, ...data });
    }

    if (action === 'create') {
      const order = payload.order || {};
      const result = createOrder(order);
      return jsonResponse({ ok: true, ...result });
    }

    if (action === 'update') {
      const rowNumber = payload.rowNumber;
      const order = payload.order || {};
      const result = updateOrder(rowNumber, order);
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
  const lastRow = sheet.getLastRow();
  const range = sheet.getRange(1, 1, Math.max(lastRow, 50), 15);
  const values = range.getValues();
  const displayValues = range.getDisplayValues();

  // Đọc KPI từ dòng 5 (dòng 5: C, E, G, I)
  const totalRevenue = displayValues[4] ? displayValues[4][3] || '' : '';
  const totalOrders = displayValues[4] ? displayValues[4][5] || '' : '';
  const totalCost = displayValues[4] ? displayValues[4][7] || '' : '';
  const profit = displayValues[4] ? displayValues[4][9] || '' : '';

  const orders = [];
  let nextEmptyRow = 8;

  for (let i = 7; i < values.length; i++) {
    const rowNum = i + 1;
    const r = values[i];
    const d = displayValues[i];

    const customerName = String(d[2] || '').trim();
    const product = String(d[3] || '').trim();

    if (!customerName && !product) {
      if (nextEmptyRow === 8) nextEmptyRow = rowNum;
      continue;
    }

    const buyDate = formatDateISO(r[8], d[8]);
    const endDate = formatDateISO(r[10], d[10]);

    orders.push({
      rowNumber: rowNum,
      stt: String(d[1] || orders.length + 1),
      customerName: customerName,
      product: product,
      phone: String(d[4] || '').trim(),
      channel: String(d[5] || '').trim(),
      salePrice: String(d[6] || '').trim(),
      costPrice: String(d[7] || '').trim(),
      buyDate: buyDate,
      months: String(d[9] || '1').trim(),
      endDate: endDate,
      reminderText: String(d[11] || '').trim(),
      note: String(d[12] || '').trim()
    });

    nextEmptyRow = rowNum + 1;
  }

  const today = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');

  return {
    orders: orders,
    kpi: { totalRevenue, totalOrders, totalCost, profit },
    today: today,
    nextEmptyRow: nextEmptyRow,
    syncedAt: new Date().toISOString()
  };
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

  const rowData = [
    order.customerName || '',
    order.product || '',
    order.phone ? "'" + order.phone : '',
    order.channel || 'Khác',
    order.salePrice || '',
    order.costPrice || '',
    formatDateVN(order.buyDate),
    order.months || '1',
    `=EDATE(I${targetRow},J${targetRow})`,
    '',
    order.note || ''
  ];

  sheet.getRange(targetRow, 3, 1, rowData.length).setValues([rowData]);

  return { targetRow: targetRow, message: 'Đã thêm đơn hàng thành công!' };
}

function updateOrder(rowNumber, order) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  const rowData = [
    order.customerName || '',
    order.product || '',
    order.phone ? "'" + order.phone : '',
    order.channel || 'Khác',
    order.salePrice || '',
    order.costPrice || '',
    formatDateVN(order.buyDate),
    order.months || '1',
    `=EDATE(I${rowNumber},J${rowNumber})`,
    '',
    order.note || ''
  ];

  sheet.getRange(rowNumber, 3, 1, rowData.length).setValues([rowData]);

  return { rowNumber: rowNumber, message: 'Đã cập nhật đơn hàng thành công!' };
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
  const parts = String(iso).split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return iso;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
