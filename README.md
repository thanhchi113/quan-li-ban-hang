# Quản Lý Đơn Hàng & Nhắc Hẹn (Google Sheet & Calendar Sync)

Hệ thống quản lý đơn hàng, theo dõi giao hẹn, đồng bộ trực tiếp 2 chiều với Google Sheets và tự động đặt lịch nhắc hẹn lên Google Calendar trong 60 ngày.

## 🌟 Tính năng chính

1. **Giao diện chuẩn hiện đại (Taste Skill frontend):**
   - Không tràn ngang, responsive trên cả máy tính và điện thoại.
   - Hỗ trợ đổi chế độ **Sáng / Tối (Dark / Light Mode)** và **Độ tương phản cao**.
   - Bộ chọn màu chủ đạo tùy ý (7 bảng màu preset + màu tùy chọn mã HEX cá nhân).
   - Thanh cuộn đồng bộ màu sắc với giao diện hệ thống.
   - Nút bật nhanh lên đầu trang (Back to top) và thanh tiêu đề bảng cố định (sticky header) khi cuộn xem danh sách.

2. **Quản lý đơn hàng & khách hàng:**
   - Cửa sổ nhỏ tạo đơn mới có thể thu gọn / mở rộng linh hoạt.
   - Cột khách hàng thu gọn thông minh, bấm xem modal đầy đủ chi tiết và có thể sửa trực tiếp.
   - Thống kê tự động: đếm số đơn hàng theo từng ngày, lọc xem theo khoảng ngày tùy chọn (hôm nay, 7 ngày, tháng này, tùy chọn).

3. **Đồng bộ dữ liệu thời gian thực:**
   - Kết nối 2 chiều với **Google Sheets**: dữ liệu mới ghi nhận lập tức trên Sheet và ngược lại.
   - Tự động đồng bộ lịch hẹn lên **Google Calendar** trong 60 ngày tới.

4. **Bảo mật & Phân quyền truy cập:**
   - Đăng nhập bảo mật bằng mật khẩu mã hóa PBKDF2/SHA-256.
   - Cơ chế quên mật khẩu: gửi mã xác thực OTP 6 số về email chính chủ `badaoqn132@gmail.com`.
   - Hỗ trợ đưa web ra Internet an toàn thông qua Cloudflare Tunnel không cần mở cổng modem.

## 🚀 Cài đặt & Khởi chạy

### Yêu cầu:
- [Node.js](https://nodejs.org/) (phiên bản 18+ khuyến nghị).

### Các bước khởi chạy:
1. Cài đặt các gói phụ thuộc:
   ```bash
   npm install
   ```
2. Cấu hình bảo mật:
   - Hệ thống tự tạo `auth-config.json` khi khởi động lần đầu với email quản trị.
3. Chạy hệ thống:
   - Cách 1: Chạy file `start.bat`
   - Cách 2: Mở terminal chạy lệnh:
     ```bash
     node server.js
     ```
4. Truy cập giao diện tại: `http://localhost:3000`

---
*Phát triển và tối ưu bởi Thanh Chí.*
