# Hướng dẫn đóng góp

Các quy ước dưới đây giúp team làm việc nhất quán khi repository được phát triển.

## Branch

Tạo branch từ nhánh mặc định mới nhất. Dùng chữ thường, dấu gạch ngang và tiền tố mô tả loại thay đổi:

- `feature/<mo-ta>` — tính năng
- `fix/<mo-ta>` — sửa lỗi
- `docs/<mo-ta>` — tài liệu
- `chore/<mo-ta>` — công việc bảo trì

Ví dụ: `docs/backend-setup-guide`.

## Commit

- Viết thông điệp ngắn gọn, ở dạng mệnh lệnh, nêu rõ thay đổi.
- Dùng tiền tố nhất quán: `feat:`, `fix:`, `docs:`, `chore:`, `test:`.
- Mỗi commit nên tập trung vào một mục đích.

Ví dụ: `docs: add backend repository guide`.

## Pull Request

- Tạo Pull Request từ branch công việc vào nhánh mặc định.
- Đặt tiêu đề rõ ràng, dùng cùng tiền tố với loại thay đổi, ví dụ `docs: add contribution guide`.
- Mô tả mục đích, nội dung thay đổi và cách kiểm tra (nếu có).
- Liên kết issue liên quan và cung cấp ảnh hoặc thông tin bổ sung khi phù hợp.
- Chờ review và xử lý các góp ý trước khi hoàn tất Pull Request.
