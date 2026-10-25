@echo off
chcp 65001 >nul
echo ============================================================
echo   ĐỒNG BỘ VÀ ĐẨY CODE LÊN GITHUB (thanhchi113)
echo ============================================================

cd /d "%~dp0"

git status --short

set /p REPO_URL="Nhập URL repository (mặc định: https://github.com/thanhchi113/quan-li-ban-hang.git): "
if "%REPO_URL%"=="" set REPO_URL=https://github.com/thanhchi113/quan-li-ban-hang.git

git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo.
echo Đang thêm file và tạo commit (nếu có thay đổi mới)...
git add .
set /p COMMIT_MSG="Nhập ghi chú commit (mặc định: update): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=update
git commit -m "%COMMIT_MSG%" 2>nul

echo.
echo Đang đẩy dữ liệu lên GitHub branch main...
git branch -M main
git push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo [THÀNH CÔNG] Đã đẩy toàn bộ mã nguồn lên GitHub!
) else (
    echo.
    echo [LỖI] Đẩy code thất bại. Vui lòng kiểm tra lại URL repository hoặc kết nối mạng.
)

echo.
pause
