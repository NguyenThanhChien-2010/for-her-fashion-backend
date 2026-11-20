# Tích hợp BE-01

## Phối hợp

Nguyễn Đức Phát cung cấp chức năng gửi thông báo. Các thành viên còn lại sử dụng cơ chế xác thực, phân quyền, upload và giao dịch CSDL đã thống nhất.

## Prisma và transaction

`PrismaModule` cung cấp một `PrismaService` qua DI. Service điều phối mở transaction, rồi truyền cùng `PrismaTransactionClient` vào các service ghi dữ liệu. Trong luồng tạo tài khoản nội bộ, callback của `IdempotencyService` thực hiện cả validate trùng, tạo user và ghi audit trên `tx`. Bản ghi kết quả replay commit cùng các thay đổi đó.

```ts
import { PrismaTransactionClient } from '../common/database/prisma.service';

async function recordAudit(tx: PrismaTransactionClient, actorId: number, accountId: number) {
  await tx.auditLog.create({
    data: {
      actorId,
      action: 'INTERNAL_ACCOUNT_CREATE',
      entityType: 'User',
      entityId: String(accountId),
    },
  });
}
```

Xem `AdminAccountsService.createAccount` cho đường gọi thực tế. Ghi audit bắt buộc bằng cùng `tx` và chỉ lưu phần cần truy vết. Hành động bên ngoài MySQL chạy sau commit hoặc thông qua outbox của nghiệp vụ.

## Idempotency

Chỉ áp dụng header ở operation mà contract yêu cầu. Lấy chủ thể từ phiên hiện tại và đặt scope ổn định theo operation. Truyền biểu diễn xác định của payload đã chuẩn hóa làm tham số cuối của `execute(subjectKey, key, scope, callback, canonicalRequest)`. Callback nhận `tx` và trả `{ statusCode, data }` với dữ liệu JSON thuần. Service lưu HMAC của request, giữ kết quả 24 giờ cho luồng hiện tại và trả 409 nếu key đang xử lý hoặc không khớp payload. Khóa cũ chưa có fingerprint được giữ đến hạn và không được replay tự động.

`IDEMPOTENCY_SECRET` nên là giá trị ngẫu nhiên ổn định dùng chung giữa các instance. Khi chưa khai báo, service sử dụng secret JWT hiện hành. Việc đổi secret trong thời gian retention làm khóa cũ mất khả năng replay. Các luồng tài chính phải có chính sách retention bền vững theo contract trước khi dùng service cho nghiệp vụ đó.

## JWT, quyền và sở hữu

Route mặc định yêu cầu Bearer access token. Dùng `@Roles(...)` cho nhóm được phép và lấy user qua `@CurrentUser()`. Kiểm tra sở hữu trong truy vấn bằng danh tính đã xác thực. Import `UploadsModule` rồi inject `UploadsService` cho nghiệp vụ cần gắn tệp. Gọi `requireOwnedFile(fileId, actor.id, 'REVIEW', tx)` trong transaction gắn ảnh. Hàm chỉ trả ID khi cả owner và purpose khớp.

Upload PRODUCT dành cho STAFF/ADMIN theo quyền ghi danh mục. REFUND_EVIDENCE dành cho ADMIN theo các operation ghi chứng từ hoàn tiền và đối soát. Các route nghiệp vụ kiểm tra quyền trên tài nguyên đích và giới hạn số ảnh. Tệp mới lưu ở `UPLOAD_DEST` và trả access PRIVATE. Giữ thư mục này ngoài static serving.

## Event email bàn giao BE-06

`src/modules/auth/auth-mail.events.ts` export hai tên event và kiểu payload `AuthMailEvent`. M01 phát `AUTH_EMAIL_VERIFICATION` sau khi đăng ký hoặc tạo mã xác thực mới, và phát `AUTH_PASSWORD_RESET` khi yêu cầu quên mật khẩu tạo mã đặt lại. Event được phát sau khi giao dịch lưu mã thành công.

Consumer M13 nhận `{ userId, token }`, dùng `userId` để xác định địa chỉ và gửi link phù hợp. M13 xử lý lỗi gửi và retry theo hạ tầng thông báo. Giữ token một lần ngoài log, audit và response API.

Suite `tests/be01.mysql-spec.ts` có consumer in-memory dành cho test. Để nghiệm thu giao thư, nối consumer thật với hộp thư test, lấy mã từ thư nhận được rồi gọi confirm/reset.

## HTTP, Swagger và migration

Frontend xử lý lỗi theo `error.code`. Ba tên cũ `VALIDATION_ERROR`, `UNAUTHORIZED` và `INTERNAL_SERVER_ERROR` lần lượt đổi thành `BAD_REQUEST`, `UNAUTHENTICATED` và `INTERNAL_ERROR`. Khi sửa role/status gặp 409 `VERSION_CONFLICT`, đọc lại account trước lần cập nhật tiếp theo. Mất kết nối MySQL hoặc hết thời gian chờ lấy kết nối có thể trả 503 `DEPENDENCY_UNAVAILABLE`.

Khi cập nhật trạng thái thành `LOCKED`, lý do khóa tối đa 255 ký tự theo cột MySQL. Nếu vượt giới hạn, API trả 400 `BAD_REQUEST` với chi tiết ở trường `reason`. Lý do mở khóa vẫn tối đa 2.000 ký tự và được lưu vào audit.

`/docs-json` phục vụ YAML của nhóm. Hai route login và `POST /auth/refresh` thực tế trả 401 khi thông tin xác thực sai. Logout trả 204 kèm `X-Request-ID`. Swagger sinh từ controller và bộ HTTP test đã mô tả các trường hợp này; YAML v1.0.2 chưa liệt kê chúng tại từng operation.

Khai DTO và `operationId` theo OpenAPI. Với mỗi route, lấy danh sách HTTP status lỗi trong `responses` của operation tương ứng và truyền đầy đủ vào `@ApiErrorResponses(...statuses)`. Decorator dùng chung schema lỗi và thêm `Retry-After` cho 429. Khi thay đổi tài liệu cho một route, chạy `npm run test:e2e` để kiểm tra Swagger. Nếu module mới có test contract riêng, đối chiếu cả status, schema và header với YAML như bộ test của M01/Shared.

Controller trả data thuần. Dùng `apiErrorPayload` khi cần mã lỗi cụ thể. App tự bọc envelope và gắn `X-Request-ID`. Các route 204 giữ body rỗng.

Mỗi thay đổi schema đi cùng migration mới và kết quả apply trên MySQL trống. Gửi seed có thứ tự, điều kiện môi trường và cách chạy lại cho người phụ trách tích hợp. Sau migration, chạy validate, generate và các test nghiệp vụ tương ứng.
