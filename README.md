# For Her Fashion Backend

Backend dùng NestJS và TypeScript, tổ chức theo hướng Modular Monolith. Prisma quản lý schema và migration MySQL. Repository có khung JWT, Swagger/OpenAPI contract và cấu hình Docker cho phát triển local.

## Yêu cầu

- Node.js 24.x và npm 11.x.
- Docker Desktop hoặc Docker Engine với Docker Compose.

## Cấu hình và chạy local

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
docker compose up -d mysql
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
```

Docker Compose tự tạo database `for_her_fashion_dev` trên MySQL 8. Cổng host là `3307`, cổng trong container là `3306`. Migration đã commit tạo các bảng theo schema thống nhất tại `prisma/schema.prisma`; không cần tạo database hoặc bảng thủ công trong MySQL Workbench.

Sau đó chạy API:

```bash
npm run start:dev
```

### 3. Kết nối bằng MySQL Workbench (tùy chọn)

Tạo connection với host `127.0.0.1`, port `3307`, user `app_user`, password lấy từ `MYSQL_PASSWORD` trong `.env`, và schema mặc định `for_her_fashion_dev`. Workbench chỉ dùng để xem hoặc thao tác database local.

## API và tài liệu

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI contract: [`docs/for-her-fashion-openapi.yaml`](docs/for-her-fashion-openapi.yaml)

Swagger UI hiển thị contract API đã thống nhất. Các endpoint trong contract là đặc tả; cần được triển khai theo từng module trước khi có thể gọi thành công.

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
```

Test kiểm tra contract OpenAPI được parse và có version/path hợp lệ. Chưa có tích hợp MoMo, KiotViet hoặc email; khi bổ sung, test các tích hợp này bằng mock và không dùng credentials thật.

## GitHub Actions CI

CI chạy khi tạo/cập nhật Pull Request vào `main` và khi push lên `main`. Workflow dùng Node.js 24, `npm ci`, MySQL 8 tạm cho test, rồi validate/generate Prisma, áp dụng migration, lint chỉ kiểm tra (`--no-fix`), build và test. CI dùng `DATABASE_URL` riêng, không đọc `.env` local.

Trong GitHub, mở **Checks** ở PR hoặc commit rồi chọn **Details** để xem log. Khi `Application checks` thành công, các bước kiểm tra ứng dụng trong workflow đã chạy qua.
