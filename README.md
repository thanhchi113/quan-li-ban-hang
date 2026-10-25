# Quản Lý Bán Hàng & Nhắc Hẹn (Google Sheets & Google Calendar)

Hệ thống quản lý bán hàng online, theo dõi gia hạn dịch vụ, đồng bộ 2 chiều với Google Sheets và đặt lịch nhắc hẹn tự động trên Google Calendar.

## 🌐 Truy cập Web Trực Tiếp (GitHub Pages)

- **Địa chỉ Web:** [https://thanhchi113.github.io/quan-li-ban-hang/](https://thanhchi113.github.io/quan-li-ban-hang/)
- **Bảo mật truy cập:** Khi mở link, hệ thống yêu cầu mật khẩu quản trị cá nhân.
- **Mật khẩu ban đầu mặc định:** `badao132`
*(Bạn có thể đổi mật khẩu bất kỳ lúc nào trong mục **Web & Bảo mật** hoặc **Khóa Web** khi không dùng).*

---

## 🌟 Tính năng nổi bật

1. **Giao diện chuẩn hiện đại (Taste Skill frontend):**
   - Hoạt động 100% trên cả máy tính, máy tính bảng và điện thoại (không tràn ngang, responsive).
   - Đầy đủ chế độ **Sáng / Tối (Dark / Light Mode)** và tùy biến bộ màu thương hiệu Thanh Chí Edu.
   - Nút bật nhanh lên đầu trang (Back to top) và cố định tiêu đề bảng (Sticky Header).
   - Nút **[Khóa Web]** trên thanh điều hướng giúp khóa màn hình ngay lập tức khi rời máy.

2. **Quản lý đơn hàng & Thống kê thông minh:**
   - Cửa sổ nhỏ tạo đơn mới linh hoạt, có thể thu gọn / mở rộng.
   - Xem chi tiết khách hàng qua modal dạng popup và cho phép chỉnh sửa thông tin nhanh.
   - Thống kê tự động đếm số đơn hàng theo ngày hoặc theo khoảng thời gian tùy chọn.

3. **Cơ chế đồng bộ dữ liệu linh hoạt (2 cách):**
   - **Cách 1 (Không cần bật máy tính - khuyên dùng):** Sử dụng Google Apps Script Web App. Chỉ cần sao chép file [`GoogleAppsScript.js`](GoogleAppsScript.js) vào Tiện ích mở rộng -> Apps Script trên Google Sheet của bạn và dán URL vào phần Cài đặt Web.
   - **Cách 2 (Máy chủ Node.js & Cloudflare Tunnel):** Chạy `node server.js` hoặc file `start.bat` để đồng bộ lịch Google Calendar 60 ngày và nhận mã OTP về email `badaoqn132@gmail.com`.

---

## 🚀 Hướng dẫn cập nhật mã nguồn lên GitHub

Mỗi khi chỉnh sửa giao diện hoặc code, bạn chỉ cần nhấp đúp file:
```cmd
push-to-github.bat
```
Script sẽ tự động commit và đẩy toàn bộ thay đổi lên GitHub Pages trong vài giây.

---
*Phát triển bởi Thanh Chí.*
