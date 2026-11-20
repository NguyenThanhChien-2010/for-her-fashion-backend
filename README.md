# For Her Fashion Backend

Backend dùng NestJS và TypeScript, tổ chức theo hướng Modular Monolith. Prisma quản lý schema và migration MySQL. Repository có khung JWT, Swagger/OpenAPI contract và cấu hình Docker cho phát triển local.

## Yêu cầu

- Node.js 24.x và npm 11.x.
- Docker Desktop hoặc Docker Engine với Docker Compose.

## Cấu hình và chạy local

Chạy các lệnh bên dưới trong thư mục `for-her-fashion-backend`.

### 1. Tạo file môi trường

Chỉ sao chép mẫu khi chưa có `.env`:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Trên macOS/Linux:

```bash
test -f .env || cp .env.example .env
```

Mở `.env` và đặt `MYSQL_PASSWORD`. Dùng cùng giá trị đó trong `DATABASE_URL`. Mẫu mặc định kết nối database local qua `localhost:3307`; `.env` không được commit lên Git.

### 2. Khởi động MySQL và tạo các bảng

```bash
docker compose up -d --wait mysql
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
```

Docker Compose tự tạo database `for_her_fashion_dev` trên MySQL 8. Cổng host là `3307`, cổng trong container là `3306`. Migration đã commit tạo các bảng theo schema thống nhất tại `prisma/schema.prisma`; không cần tạo database hoặc bảng thủ công trong MySQL Workbench.

Tạo tài khoản quản trị local theo mục [Seed tài khoản quản trị](#seed-tài-khoản-quản-trị), rồi chạy API:

```bash
npm run start:dev
```

### 3. Kết nối bằng MySQL Workbench (tùy chọn)

Tạo connection với host `127.0.0.1`, port `3307`, user `app_user`, password lấy từ `MYSQL_PASSWORD` trong `.env`, và schema mặc định `for_her_fashion_dev`. Workbench chỉ dùng để xem hoặc thao tác database local.

## API và tài liệu

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI contract: [`docs/for-her-fashion-openapi.yaml`](docs/for-her-fashion-openapi.yaml)

Swagger UI phục vụ contract API đã thống nhất (`docs/for-her-fashion-openapi.yaml`, 102 path của 14 module). M01 và Shared có 16 operation chạy được. Các path còn lại mô tả API của những module đang chờ triển khai.

Ghi chú tích hợp HTTP giải thích mã lỗi, các phản hồi 401 của login và refresh, header truy vết của logout và giới hạn 255 ký tự khi nhập lý do khóa tài khoản. [Ghi chú tích hợp HTTP](docs/BE-01-INTEGRATION-GUIDE.md#http-swagger-và-migration)

Để chạy cả API trong Docker local, hoàn tất migrate và seed trên host trước, rồi chạy `docker compose up -d --build --wait backend`. Compose dùng `mysql:3306` trong mạng nội bộ. Dừng API chạy trên host trước khi dùng cùng cổng 3000 cho container.

## Prisma schema và migration

`prisma/schema.prisma` là schema thống nhất của nhóm. Khi schema thay đổi, tạo migration mới trên database phát triển:

```bash
npm run prisma:migrate:dev -- --name <ten-migration>
npm run prisma:generate
```

Commit migration cùng thay đổi schema. Môi trường mới áp dụng migration bằng `npm run prisma:migrate:deploy`. Không sửa migration đã được áp dụng; không chạy lệnh reset trên database có dữ liệu cần giữ hoặc trên production. Máy local còn database từ schema scaffold cũ cần backup/đối chiếu trước khi cập nhật.

## Kiểm tra

```bash
npm run prisma:validate
npm run prisma:generate
npm run lint -- --no-fix
npm run build
npm test -- --runInBand
npm run test:e2e
```

`npm test` chạy unit test (Jest) trong `src/`, `tests/`. `npm run test:e2e` chạy các suite `*.e2e-spec.ts`
trong `tests/` bằng [jest-e2e.config.js](jest-e2e.config.js); E2E boot module graph thật nhưng stub
`PrismaService` nên không cần MySQL đang chạy.

### Bộ test hiện có

| Lớp | Nội dung |
|---|---|
| `src/common/common.spec.ts` | Envelope `{ data, traceId }`, 204 không body, map Prisma P2002/P2025/P2034, 401/403/404, `X-Request-ID` |
| `src/modules/auth/auth.service.spec.ts` | Đăng ký, xác thực email, login email/SĐT, rememberMe TTL, xoay token, replay detection, reset password thu hồi phiên, audit log |
| `src/modules/auth/admin-accounts.service.spec.ts` | Phân trang, phạm vi Staff/Admin, optimistic locking, tự khóa, tạo tài khoản nội bộ |
| `src/modules/auth/dto/auth.dto.spec.ts` | Biên mật khẩu, SĐT, pagination, `version`/`reason` bắt buộc |
| `src/modules/auth/strategies/jwt.strategy.spec.ts` | Claim sai, tài khoản LOCKED, chưa xác thực, `sid` cho logout |
| `src/common/services/file-upload.service.spec.ts` | Chữ ký định dạng, kích thước và lưu tệp |
| `tests/*.e2e-spec.ts` | Route contract, 204, phân quyền, upload multipart, Swagger đủ path M01/Shared |
| `tests/be01.mysql-spec.ts` | HTTP/MySQL 8, reset, khóa/mở, quyền hiện tại, scope file, replay và rollback |

Để chạy suite MySQL, tạo một database MySQL 8 local riêng có tên kết thúc bằng `_test`. Đặt `DATABASE_URL` và `BE01_TEST_DATABASE_URL` trỏ vào database đó, sau đó chạy migrate và seed với cùng `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` sẽ dùng cho test.

```bash
npm run prisma:migrate:deploy
npm run prisma:seed
npm run test:e2e -- --testRegex 'be01\.mysql-spec\.ts$'
```

Suite tạo fixture riêng cho mỗi lần chạy. Dùng database dành cho kiểm thử.

## Seed tài khoản quản trị

Tạo Admin đầu tiên cho môi trường local (idempotent — chạy lại không tạo trùng):

```powershell
$env:SEED_ADMIN_PASSWORD='mat-khau-du-manh-cua-ban'
npm run prisma:seed
```

Tùy chọn: `SEED_ADMIN_EMAIL` (mặc định `admin@forher.local`), `SEED_ADMIN_FULL_NAME`.
Script từ chối chạy nếu thiếu `SEED_ADMIN_PASSWORD` hoặc mật khẩu ngắn hơn 8 ký tự; không hardcode mật khẩu trong repo.

## Kiến trúc M01 & hạ tầng dùng chung

```
src/
├─ common/
│  ├─ config/        Joi schema fail-fast cho biến môi trường
│  ├─ decorators/    @Public(), @Roles(), @CurrentUser(), @IdempotencyKey()
│  ├─ errors/        ErrorCode/ErrorMessage + validationExceptionFactory
│  ├─ filters/       AllExceptionsFilter → { error, traceId }
│  ├─ guards/        JwtAuthGuard (global), RolesGuard (global)
│  ├─ interceptors/  TransformResponseInterceptor → { data, traceId }
│  ├─ services/      FileUploadService (magic byte), IdempotencyService
│  └─ swagger/       Tag M01..M14 + Shared, scheme BearerAuth
├─ modules/auth/     AuthController, MeController, AdminAuthController, AdminAccountsController
└─ modules/uploads/  UploadsController (tag Shared)
```

Quy ước bắt buộc khi thêm module mới:

- Controller trả dữ liệu thô; envelope `{ data, traceId }` do interceptor lo.
- Ném lỗi qua `apiErrorPayload(code, message, details)` để client nhận đúng `error.code`.
- Route mặc định cần JWT; chỉ thêm `@Public()` cho endpoint thật sự công khai.
- API tài nguyên thuộc người dùng phải lấy owner ID từ `@CurrentUser()` và đưa điều kiện owner vào truy vấn đọc/cập nhật/xóa; không tin `userId`/`ownerId` do request gửi. Truy cập chéo tài khoản chỉ được mở qua endpoint có role policy rõ ràng.
- Với các operation mà OpenAPI yêu cầu `Idempotency-Key`, dùng `IdempotencyService.execute(...)` để xử lý yêu cầu gửi lại.

Xem [hướng dẫn tích hợp BE-01](docs/BE-01-INTEGRATION-GUIDE.md) cho cách truyền transaction, scope file và giao event email với BE-06. Suite MySQL bắt event qua adapter test để kiểm tra xác thực và đặt lại mật khẩu. Việc giao thư cần consumer M13 và transport đã cấu hình.

## GitHub Actions CI

CI chạy khi tạo/cập nhật Pull Request vào `main` và khi push lên `main`. Workflow dùng Node.js 24, `npm ci`, MySQL 8 tạm, validate/generate Prisma, áp dụng migration trên database CI sạch, lint chỉ kiểm tra (`--no-fix`), build, unit test và HTTP E2E. E2E stub Prisma nên không gọi database; bước migration riêng xác minh schema/migration trên MySQL CI. CI dùng `DATABASE_URL` riêng, không đọc `.env` local.

Trong GitHub, mở **Checks** ở PR hoặc commit rồi chọn **Details** để xem log. Khi `Application checks` thành công, các bước kiểm tra ứng dụng trong workflow đã chạy qua.
