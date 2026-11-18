# For Her Fashion Backend

Backend khởi tạo với NestJS và TypeScript theo hướng Modular Monolith. Prisma dùng MySQL; JWT là nền tảng cho xác thực, Swagger cung cấp tài liệu API, Docker Compose chạy môi trường phát triển local.

## Yêu cầu

- Node.js 24 và npm (phiên bản cụ thể được khóa trong `package-lock.json`).
- Docker Desktop hoặc Docker Engine với Compose.

## Chạy local

```bash
Copy-Item .env.example .env # PowerShell; dùng `cp .env.example .env` trên macOS/Linux
docker compose up -d mysql
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run start:dev
```

API chạy tại `http://localhost:3000/api`, health check tại `/api/health` và Swagger tại `/docs`. `.env.example` chứa giá trị minh họa; chỉnh `DATABASE_URL` để dùng database phát triển local và thay `JWT_SECRET` bằng secret ngẫu nhiên. `.env` bị Git bỏ qua. Docker Compose khởi tạo MySQL local với database `for_her_fashion_dev`; không dùng các thông tin này cho production.

Để tạo migration mới khi thay đổi Prisma schema, dùng `npm run prisma:migrate:dev -- --name <ten-migration>` sau khi database local chạy.

## Kiểm tra local

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run lint -- --no-fix
npm run build
npm test -- --runInBand
```

Các test hiện tại kiểm tra health endpoint bằng ứng dụng kiểm thử riêng, không gọi MoMo, KiotViet hoặc email. Khi thêm tích hợp, viết test với mock và không đưa credentials bên ngoài vào CI.

## GitHub Actions CI

Workflow `.github/workflows/ci.yml` chạy khi tạo/cập nhật Pull Request vào `main` và khi push vào `main`. Job readiness truyền output `has_application` sang job ứng dụng. Nếu không có `package.json`, workflow báo ứng dụng chưa khởi tạo và bỏ qua các bước ứng dụng.

Khi ứng dụng có cấu hình, CI dùng Node.js 24 và `npm ci` theo lockfile, validate/generate Prisma, áp dụng migration đã commit, lint chỉ kiểm tra (`--no-fix`), build và chạy test. CI khởi động MySQL 8 tạm với database `for_her_fashion_test`, tài khoản `ci`/`ci` và cổng 3306. `DATABASE_URL` trong CI trỏ đúng tới service này; CI không đọc `.env` local. JWT secret CI là giá trị test riêng, không phải secret production.

Trong GitHub, mở **Checks** của PR hoặc commit rồi xem **Details** của từng job để đọc log. `Repository readiness` thành công khi không có `package.json` chỉ xác nhận workflow phát hiện repo; job ứng dụng bị bỏ qua nên chưa có kết quả build/test. Chỉ lần chạy có job `Application checks` hoàn tất mới xác nhận các bước ứng dụng đã chạy.
