# Báo cáo kết quả kiểm thử và nghiệm thu M03 – Quản lý tồn kho

> Cập nhật Bước 13.8 (27/11/2026): Mục 1–12 lưu nguyên nội dung nghiệm thu Bước 12; kết quả hiện hành và điều kiện bàn giao được cập nhật ở Mục 13–18.

## 1. Thông tin chung

| Hạng mục | Nội dung |
| --- | --- |
| Dự án | For Her Fashion Backend |
| Phụ trách | BE-02 |
| Phạm vi | M03 – Inventory; các service hỗ trợ M06 – Order Management |
| Module phối hợp | M07 – Thanh toán, M08 – Tích hợp KiotViet |
| Nhánh | `feature/be-02-m03` |
| Commit nền tại thời điểm kiểm tra | `068d2a5` |
| Ngày lập báo cáo | 27/11/2026 |
| Kết luận đề xuất | Đạt trong phạm vi kiểm thử đã thực hiện; bàn giao tích hợp nội bộ có điều kiện |

Báo cáo tổng hợp log thực thi trên máy phát triển, không phải biên bản phê duyệt của leader. Các thay đổi M03 và tài liệu đang ở working tree, chưa được commit tại thời điểm lập báo cáo.

## 2. Phạm vi nghiệm thu

- Kiểm tra tồn bán, chuẩn hóa số lượng theo SKU và từ chối yêu cầu không hợp lệ.
- Trừ tồn bằng `OrderInventoryService.deductForOrder()` trong transaction của bên gọi.
- Ghi `InventoryMovement` và `PendingInventoryEffect` nhất quán với nghiệp vụ tồn kho.
- Chống trừ tồn lặp theo Operation Key; hoàn tồn local-only đã xác minh ở cấp unit test.
- Đăng ký và export `OrderInventoryService` qua `InventoryModule`.
- Kiểm thử cạnh tranh SKU cuối cùng và rollback đơn nhiều SKU trên MySQL thật.

Không đồng nghĩa với nghiệm thu toàn bộ luồng đặt hàng, thanh toán, hủy đơn hoặc đồng bộ KiotViet trong môi trường vận hành thực tế.

## 3. Môi trường kiểm thử

| Thành phần | Giá trị |
| --- | --- |
| Backend | NestJS, TypeScript |
| Prisma / Prisma Client | 6.19.3 |
| MySQL kiểm thử | 8.0.46 |
| Container kiểm thử | `for-her-fashion-m03-test` |
| Địa chỉ kiểm thử | `127.0.0.1:3308` |
| Database kiểm thử | `for_her_fashion_m03_test` |
| Volume kiểm thử | `for-her-fashion-m03-test-data` |
| Container Development | `for-her-fashion-backend-mysql-1`, port 3307 |
| Storage engine | InnoDB trên 12 bảng bắt buộc đã kiểm tra |
| Isolation mặc định của session | REPEATABLE-READ |
| Isolation được cấu hình trong integration test | `ReadCommitted` qua Prisma |

Database kiểm thử độc lập với Development; không dùng dữ liệu khách hàng thật. Các script kiểm tra tên database, hostname, URL đích và yêu cầu xác nhận trước khi tạo fixture. Không ghi mật khẩu hoặc URL chứa mật khẩu vào báo cáo. Isolation thực tế của từng transaction chưa được đo độc lập với cấu hình Prisma.

## 4. Kiểm tra cấu trúc database và migration

Kết quả Bước 12.4-B.3.3 và 12.4-B.4:

| Hạng mục | Kết quả |
| --- | --- |
| Migration hiện có được áp dụng | 5/5 PASS |
| Tổng số bảng | 65 |
| Bảng bắt buộc sử dụng InnoDB | 12/12 PASS |
| Prisma model read check | 12/12 PASS |
| Unique index phục vụ tồn kho và chứng từ | 3/3 PASS |
| Dữ liệu ban đầu | 0 bản ghi trong 12 model được kiểm tra |

Ba ràng buộc duy nhất đã xác minh: `inventories.variantId`, `inventory_movements.operationKey`, `pending_inventory_effects.operationKey`.

Danh sách migration đã áp dụng trên DB Test:

1. `20261118000000_init`
2. `20261125143436_add_discontinued_product_status`
3. `20261126030000_add_size_chart_instructions`
4. `20261126040000_add_variant_display_labels`
5. `20261127000000_expand_inventory_adjustment_reason`

Migration cuối mở rộng `inventory_adjustments.reason` từ `VARCHAR(500)` thành `VARCHAR(2000) NOT NULL`. Việc áp dụng migration này trên Development hoặc môi trường triển khai chưa được xác minh trong báo cáo. Không tạo migration trùng; thực hiện triển khai theo quy trình của nhóm.

## 5. Kiểm thử hồi quy cuối cùng (Bước 12.6-A.1)

| Hạng mục | Kết quả |
| --- | --- |
| Jest Inventory Unit Test Suites | 9/9 PASS |
| Tổng số Unit Test | 280/280 PASS |
| Test thất bại | 0 |
| Thời gian Jest | 16,902 giây |
| TypeScript (`tsc --noEmit`) | PASS |
| ESLint thư mục Inventory | PASS |
| Prisma Schema Validation | PASS |
| Type-check Concurrency Script | PASS |
| Type-check Rollback Script | PASS |
| Git diff --check (tracked và staged) | PASS |

### 5.1. Danh sách test suite

| File trong `src/modules/inventory/` | Kết quả |
| --- | --- |
| `admin-inventory.service.spec.ts` | PASS |
| `inventory-adjustment.service.spec.ts` | PASS |
| `inventory-ledger.service.spec.ts` | PASS |
| `inventory-movement.service.spec.ts` | PASS |
| `inventory-reconciliation.service.spec.ts` | PASS |
| `inventory.service.spec.ts` | PASS |
| `pending-inventory-effect.service.spec.ts` | PASS |
| `order-inventory.service.spec.ts` | PASS |
| `inventory.module.spec.ts` | PASS |

### 5.2. Chi tiết các test hỗ trợ M06

| Nhóm test | Số lượng | Nội dung |
| --- | ---: | --- |
| AVL-01 đến AVL-06 | 6 | Kiểm tra tồn, SKU trùng, đầu vào không hợp lệ, SKU không bán được |
| DED-01 đến DED-10 | 10 | Trừ tồn, lỗi thiếu tồn, replay, thứ tự khóa SKU, trạng thái, version |
| REL-01 đến REL-12 | 12 | Hủy đơn, hết hạn thanh toán, hoàn tồn lặp, chứng từ gốc, trạng thái nguồn |
| DI-01 đến DI-04 | 4 | Provider, export, inject service và Prisma Mock |

32 test trên đã nằm trong tổng 280 test, không cộng thêm. Các unit test dùng mock; không chứng minh đầy đủ hành vi MySQL hoặc hợp đồng HTTP của M06. Bước hồi quy cuối chỉ chạy 9 suite Inventory, không chạy toàn bộ test của repository. Các kiểm thử E2E HTTP và kiểm thử tích hợp cũ ngoài phạm vi Bước 12 không được chạy lại trong lần hồi quy này.

## 6. Kiểm thử cạnh tranh SKU cuối cùng (Bước 12.4)

File: `scripts/test-order-inventory-concurrency.ts`.

- Mã lần chạy: `0203318f650e`.
- Variant ID: 1; SKU: `M03-0203318f650e-C0203318f-T0203318f`.
- Hai khách hàng đều vượt qua kiểm tra tồn sơ bộ; tồn ban đầu là 1, version là 1.
- Hai transaction sử dụng kết nối MySQL 143 và 144.
- Customer B thành công, Order ID 1, mã `M03-0203318f650e-B`.
- Customer A gặp `P2010` ở lần đầu, được script retry toàn bộ transaction một lần rồi nhận `INSUFFICIENT_STOCK` (409 tại cấp exception của service).

| Mã | Tiêu chí | Thực tế | Kết quả |
| --- | --- | --- | --- |
| CON-01 | Hai kết nối riêng | 143, 144 | PASS |
| CON-02 | Một đơn thành công | 1 | PASS |
| CON-03 | Một đơn bị từ chối | 1 | PASS |
| CON-04 | Mã lỗi hết hàng | INSUFFICIENT_STOCK | PASS |
| CON-05 | Tồn cuối không âm | 0 | PASS |
| CON-06 | Version tăng đúng một lần | 1 → 2 | PASS |
| CON-07 | Movement duy nhất | 1 | PASS |
| CON-08 | Pending Effect duy nhất | 1 | PASS |
| CON-09 | Chỉ lưu đơn thành công và chi tiết | 1 Order, 1 OrderItem | PASS |
| CON-10 | Replay không trừ tồn lần hai | Tồn và chứng từ không đổi | PASS |

Kết quả: 10/10 tiêu chí đạt trong kịch bản có retry. Điều kiện retry của script nhận diện P2010 khi mã MySQL trong metadata là 1213; log chỉ in P2010, không in trực tiếp metadata. Không suy rộng rằng mọi P2010 đều là deadlock.

### 6.1. Idempotency và dữ liệu đã commit

Operation Key: `M03-ORDER-1-SKU-1-DEDUCT`. Movement và Pending Effect cùng key, delta -1; reason của Movement là `ORDER_CREATED`. Sau replay, tồn bán vẫn bằng 0, version 2, sourceQuantity 1, syncStatus `PENDING`; không tăng số chứng từ. Bước 12.4-E.1 đã kiểm tra lại bằng tiến trình Prisma Client độc lập.

Kết luận: chưa phát hiện overselling trong lần chạy này. M06 phải triển khai và kiểm thử cơ chế retry toàn bộ transaction, không chỉ retry riêng lệnh trừ tồn. Cần kiểm thử thêm các kịch bản cạnh tranh khác trước khi nghiệm thu tích hợp hoàn chỉnh.

## 7. Kiểm thử rollback đơn nhiều SKU (Bước 12.5)

File: `scripts/test-order-inventory-rollback.ts`.

- Mã lần chạy: `fe3309f119af`.
- SKU-A: Variant ID 2, mã `M03-RB-fe3309f119af-A`, tồn 10, đặt 3.
- SKU-B: Variant ID 3, mã `M03-RB-fe3309f119af-B`, tồn 1, đặt 5.
- Order ID đã rollback: 4; mã `M03-RB-fe3309f119af`.
- Trong transaction, SKU-A đã giảm xuống 7, version tăng lên 2; một Movement và một Pending Effect tạm thời đã được ghi.
- SKU-B gây lỗi `INSUFFICIENT_STOCK`; lỗi được ném ra ngoài callback để Prisma rollback toàn bộ.

| Mã | Tiêu chí | Thực tế | Kết quả |
| --- | --- | --- | --- |
| RB-01 | Đúng DB Test | Port 3308 | PASS |
| RB-02 | Tạo đơn và chi tiết trong transaction | 1 Order, 2 OrderItem | PASS |
| RB-03 | Có thao tác trừ tồn thực sự | SKU-A 10 → 7 | PASS |
| RB-04 | SKU-B thiếu tồn | INSUFFICIENT_STOCK | PASS |
| RB-05 | Khôi phục SKU-A | 7 → 10 | PASS |
| RB-06 | Giữ nguyên SKU-B | 1 | PASS |
| RB-07 | Khôi phục cả hai version | 1, 1 | PASS |
| RB-08 | Không lưu đơn và chi tiết thất bại | 0, 0 | PASS |
| RB-09 | Không lưu Movement thất bại | 0 | PASS |
| RB-10 | Không lưu Pending Effect thất bại | 0 | PASS |

Kết quả: 10/10 tiêu chí đạt. Log có `PARTIAL WRITE VERIFIED`, `FULL INVENTORY SNAPSHOT PASS` và `MULTI-SKU ROLLBACK TEST PASS`. Toàn bộ snapshot Inventory được so sánh trước và sau rollback trong script. Bước 12.5-C.1 kiểm tra lại dữ liệu độc lập và xác nhận dữ liệu Concurrency trước đó vẫn còn nguyên.

## 8. Tổng hợp đối chiếu dữ liệu MySQL

| Thuộc tính | SKU Concurrency | SKU-A Rollback | SKU-B Rollback |
| --- | ---: | ---: | ---: |
| Variant ID | 1 | 2 | 3 |
| Quantity | 0 | 10 | 1 |
| Source Quantity | 1 | 10 | 1 |
| Version | 2 | 1 | 1 |
| Sync Status | PENDING | CONFIRMED | CONFIRMED |
| OrderItem | 1 | 0 | 0 |
| InventoryMovement | 1 | 0 | 0 |
| PendingInventoryEffect | 1 | 0 | 0 |

Đối với SKU Concurrency: tồn bán = 1 + (-1) = 0 trong kịch bản đã kiểm thử. Order ID 1 tồn tại; Order ID 4 không tồn tại sau rollback. Fixture giả lập được giữ trên DB Test để đối chiếu. Không yêu cầu xóa dữ liệu kiểm thử hoặc chạy lại migration ở bước lập báo cáo.

## 9. Rà soát hợp đồng tích hợp (Bước 12.6-B)

| Phương thức | Phạm vi đã xác nhận |
| --- | --- |
| `assertAvailable(items)` | Kiểm tra tồn sơ bộ, không giữ hàng |
| `deductForOrder(tx, orderId)` | Trừ tồn, ghi chứng từ trong cùng transaction; đã kiểm thử MySQL |
| `releaseForOrder(tx, orderId, reason, sourceDisposition)` | Hoàn tồn có điều kiện local-only; đã kiểm thử unit |

`InventoryModule` đăng ký và export `OrderInventoryService`. Hai service được kiểm tra SHA-256 sau chuẩn hóa xuống dòng và bỏ khoảng trắng đầu/cuối:

| File | SHA-256 chuẩn hóa |
| --- | --- |
| `order-inventory.service.ts` | `bba736a660426b80aa69f38c3edfc790ebba21d166b9066d271c5649a780a4c9` |
| `inventory-ledger.service.ts` | `ac3d91514e1f3926a4c466225e560bc4c5e80990cc33d3c103e1bb3f32f93b12` |

Hai giá trị khớp tại Bước 12.6-B.2. Nhánh được rà soát chưa có module M06/M08 thực tế; chỉ có đăng ký InventoryModule trong AppModule, chưa có tích hợp đầu cuối. Hướng dẫn chi tiết tại [M03_M06_INTEGRATION_GUIDE.md](M03_M06_INTEGRATION_GUIDE.md).

## 10. Rủi ro và điều kiện bàn giao

| Mã | Vấn đề còn tồn đọng | Hướng xử lý đề xuất |
| --- | --- | --- |
| R01 | Kiểm tra sơ bộ không giữ tồn | M06 phải trừ tồn trong transaction tạo Order và OrderItem |
| R02 | Deadlock khi tạo đơn đồng thời | M06 triển khai retry toàn bộ transaction có giới hạn, giữ nguyên idempotency key; xem xét thứ tự khóa |
| R03 | Hủy đơn đã đồng bộ KiotViet | M06/M08 xác minh trạng thái nguồn, tránh hoàn tồn hai lần |
| R04 | Vòng đời cặp Pending Effect trừ và hoàn local | M03/M08 thống nhất quy tắc đối soát; không tự xác nhận tại nguồn |
| R05 | Cạnh tranh đổi trạng thái Product/SKU | Bổ sung kiểm thử khóa và cập nhật đồng thời |
| R06 | Hủy đơn thông thường có thanh toán | M06/M07 kiểm tra thanh toán, hoàn tiền và trạng thái giao hàng |
| R07 | Chưa có tích hợp M06/M07/M08 hoàn chỉnh | Kiểm thử đầu cuối sau khi ghép module |
| R08 | HTTP response `INSUFFICIENT_STOCK` | Kiểm tra controller và global exception filter; giữ mã lỗi nghiệp vụ |
| R09 | Replay sau thay đổi trạng thái đơn | Xác định và kiểm thử phạm vi replay được hỗ trợ |
| R10 | Hoàn tồn local trên MySQL thật | Bổ sung kiểm thử hủy đơn và hết hạn thanh toán trên DB Test |
| R11 | Idempotency cấp yêu cầu checkout | M06 xử lý yêu cầu trùng và cạnh tranh ở cấp Order |

Không sử dụng `VERIFIED_LOCAL_ONLY` như giá trị mặc định cho mọi yêu cầu hủy. Chỉ gọi sau khi có bằng chứng tin cậy ở server và đã điều phối để ngăn gửi đơn đồng thời sang nguồn. `releaseConfirmed()` là primitive nội bộ cần bằng chứng M08 và cập nhật Inventory trong cùng transaction đối soát; không commit riêng lẻ. Không coi `confirmAdjustment()` là luồng xử lý nguồn đầy đủ cho mọi đơn hàng.

## 11. Hướng dẫn kiểm tra lại và quản lý Git

Các lệnh chạy từ thư mục gốc repository, với dependency đã cài đặt:

```powershell
npx --no-install tsc --noEmit -p tsconfig.json
npx --no-install eslint "src/modules/inventory/**/*.ts"
$specs = @(Get-ChildItem src/modules/inventory -Filter "*.spec.ts" -File | Select-Object -ExpandProperty FullName)
npx --no-install jest --runTestsByPath $specs --runInBand
npx --no-install ts-node --typeCheck scripts/test-order-inventory-concurrency.ts --check-only
npx --no-install ts-node --typeCheck scripts/test-order-inventory-rollback.ts --check-only
npx --no-install prisma validate
```

Các lệnh trên phục vụ kiểm tra mã nguồn và unit test; hai tham số `--check-only` không chạy transaction thật. Khi cần chạy integration test, sử dụng quy trình cấu hình DB Test của nhóm, kiểm tra container, hostname, URL riêng và xác nhận ghi fixture. Script Concurrency yêu cầu `M03_RUN_CONCURRENCY=YES`, script Rollback yêu cầu `M03_RUN_ROLLBACK=YES`; cả hai cần `M03_TEST_DATABASE_URL` và `M03_EXPECTED_HOST`. Không chạy với URL Development, không đưa thông tin đăng nhập vào Git.

Danh sách cần review trước PR: `src/modules/inventory/`, `src/app.module.ts`, `prisma/schema.prisma`, migration hiện có, hai integration script, bốn file E2E Inventory và hai tài liệu bàn giao. Không dùng `git add .` khi chưa phân loại file. `prisma/schema.prisma.be02-backup` là backup không nên đưa vào PR; `prisma/seed-products-test.ts` và `scripts/test-concurrent-size-charts.mjs` cần rà soát riêng. Không xóa hoặc stage file ở bước lập báo cáo. `git diff --check` đã PASS cho tracked/staged nhưng không bao phủ nội dung untracked. Cảnh báo LF/CRLF không phải lỗi biên dịch.

## 12. Bằng chứng và kết luận

Báo cáo dựa trên log Terminal ngày 27/11/2026 do người thực hiện cung cấp. Các mốc đối chiếu:

| Bước | Dấu hiệu xác nhận trong log |
| --- | --- |
| 12.4-B.3.3 | `All migrations have been successfully applied.`; `Migration Status PASS.` |
| 12.4-B.4 | `DATABASE STRUCTURE VERIFICATION PASS` |
| 12.4-D.1 | `CONCURRENCY TEST PASS`; `IDEMPOTENCY REPLAY PASS` |
| 12.4-E.1 | `INDEPENDENT DATABASE VERIFICATION PASS` |
| 12.5-B.1 | `PARTIAL WRITE VERIFIED`; `FULL INVENTORY SNAPSHOT PASS`; `MULTI-SKU ROLLBACK TEST PASS` |
| 12.5-C.1 | `INDEPENDENT ROLLBACK VERIFICATION PASS`; `PREVIOUS CONCURRENCY DATA PASS` |
| 12.6-A.1 | `Tests: 280 passed, 280 total`; 9/9 suite PASS |
| 12.6-B.2 | Hai `SOURCE MATCH PASS`; `OrderInventoryService Export PASS.` |
| 12.6-C.2 | `Vietnamese Integration Guide created.`; `Saved Document Verification PASS.` |

### Kết luận nghiệm thu kỹ thuật đề xuất

- Đạt: kiểm thử hồi quy Inventory 280/280; cạnh tranh SKU cuối cùng 10/10 với retry; rollback đơn nhiều SKU 10/10; hai lần xác minh dữ liệu độc lập; kiểm thử DI và kiểm tra schema.
- Đạt có điều kiện: bàn giao service kiểm tra tồn, trừ tồn, hoàn tồn local-only và hướng dẫn tích hợp M06.
- Chưa nghiệm thu: các điều kiện tích hợp thực tế nêu tại Mục 10, toàn bộ E2E của repository và khả năng sẵn sàng vận hành production.

Hai nhóm 10 tiêu chí là điều kiện nghiệm thu của hai kịch bản integration test, không phải 20 unit test bổ sung. Kết quả này không chứng minh an toàn cho mọi trường hợp cạnh tranh.

**Trạng thái phê duyệt:** Chờ leader/reviewer và các thành viên M06/M07/M08 xác nhận phạm vi bàn giao. Chưa có xác nhận merge hoặc triển khai. Không thực hiện commit, push hoặc migration trong bước lập báo cáo này.

---

## 13. Cập nhật nghiệm thu Bước 13 — nghiệp vụ hàng hoàn

**Ngày 27/11/2026, nhánh `feature/be-02-m03`, commit nền `068d2a5`.** Mục 1–12 lưu kết quả lịch sử Bước 12. Kết quả hiện hành của Inventory là các mục 13–18 dưới đây. M06/M08/M11 chưa nghiệm thu đầu cuối; tất cả evidence KiotViet trong Integration Test là giả lập trên database test. Báo cáo là đề xuất nghiệm thu nội bộ, không phải phê duyệt của leader.

### 13.1. Phạm vi bổ sung

ReturnInventoryService và contract: kiểm tra phiếu khách trả/giao thất bại, số lượng cộng dồn, evidence nguồn, đối soát pending effect, hoàn tồn theo resalable, replay, nhánh không tăng tồn, DI. Không bổ sung controller public nhận evidence; không thực hiện thanh toán, hoàn tiền, thông báo hay đồng bộ nguồn thật. Hướng dẫn tích hợp tại [M03_M06_INTEGRATION_GUIDE.md](M03_M06_INTEGRATION_GUIDE.md), Mục 17–18.

### 13.2. Môi trường và dữ liệu

MySQL 8.0.46, Prisma 6.19.3, test container `for-her-fashion-m03-test`, port 3308 chỉ bind 127.0.0.1, volume `for-her-fashion-m03-test-data`, database `for_her_fashion_m03_test`. Bước 13.6-A.1 xác minh 18 bảng InnoDB, 9 unique index yêu cầu, 5 migration đã áp dụng, 18 Prisma model đọc được; không tạo migration mới. Test transaction dùng cấu hình ReadCommitted, không đổi isolation mặc định. Development port 3307 không được sử dụng trong bài test hàng hoàn. Run tag `ff7ceb8f`, 7 fixture, 8 SKU hàng hoàn. Dữ liệu đơn hàng Bước 12 vẫn được giữ nguyên. Không đưa thông tin kết nối có mật khẩu hoặc dữ liệu khách hàng thật vào tài liệu.

## 14. Final Regression — 13.7-A.1

| Hạng mục | Kết quả thực tế |
|---|---|
| Prisma schema validate | PASS |
| TypeScript `tsc --noEmit` | PASS |
| ESLint Inventory | PASS |
| Jest Inventory | 17/17 suite, 511/511 test |
| Failed suite/test | 0/0 |
| Pending/todo test | 0/0 |
| Thời gian Jest | 20,28 giây |
| Integration scripts | 10/10 check-only, không kết nối DB |
| Audit DB độc lập | 7 hàng hoàn + 2 đơn hàng PASS |
| File được bảo vệ | 47 không đổi, gồm manifest và tài liệu cũ; env/audit script/Git state không đổi |

| Nhóm test | Số test |
|---|---:|
| 9 suite Inventory trước Bước 13 | 280 |
| return-inventory.contract.spec.ts | 40 |
| return-inventory.service.spec.ts | 30 |
| return-inventory-source.spec.ts | 46 |
| return-inventory-reconciliation.spec.ts | 36 |
| return-inventory-apply.spec.ts | 22 |
| return-inventory-replay.spec.ts | 30 |
| return-inventory-non-resalable.spec.ts | 22 |
| return-inventory-module.spec.ts | 5 |
| **Tổng** | **511** |

231 test mới nằm trong 511; 280 test lịch sử không cộng lần nữa. 10 script check-only không phải 10 integration scenario đã thực thi. Final Regression chỉ bao phủ Inventory, không phải toàn bộ Unit Test và HTTP E2E repository. Unit Test sử dụng mock trong phạm vi phù hợp; không thay thế hành vi DB thật.

## 15. Kết quả Integration Test MySQL — Bước 13.6

| Kịch bản | Order / receipt / SKU | Kết quả thực tế | Nghiệm thu nội bộ |
|---|---|---|---|
| IT-R01 Customer Return | 5 / customer 1 / 4 | Nhận 4, accepted 3, resalable 2; tồn 10 → 12, version 3 → 4, movement/effect 12 | PASS |
| IT-R02 Delivery Return | 6 / delivery 1 / 5 | Nhận 5, resalable 3; tồn 10 → 13, version 3 → 4; actor null; movement/effect 13 | PASS |
| IT-R03 Replay | 7 / customer 2 / 6 | Tồn 10 → 12 → 12 → 12, version 3 → 4 → 4 → 4; hai replay cùng ID 14; sai version lịch sử bị từ chối 409 | PASS |
| IT-R04 Concurrency | 8 / customer 3 / 7 | Hai kết nối 1435/1436, hai transaction commit; B ghi mới, A replay; một cặp ID 15, tồn 10 → 12, version 3 → 4 | PASS |
| IT-R05 Rollback | 9 / customer 4 / 8,9 | Cả hai SKU tồn 10 → 12 → 10, version 3 → 4 → 3; ID 16,17 được ghi trong tx rồi rollback; không còn cặp hàng hoàn mới | PASS |
| IT-R06 Non-resalable | 10 / customer 5 / 10 | Nhận 4, accepted 3, resalable 0; hai NO_STOCK_CHANGE; hai từ chối 409 (evidence chưa liên kết, phiếu dương đi luồng 0); tồn 10/version 3 giữ nguyên | PASS |
| IT-R07 Pending reconciliation | 11 / customer 6 / 11 | Nguồn 10 → 12, tồn bán 8 → 10, version 4 → 5; effect Order 12 −2 giữ PENDING v1; cặp hàng hoàn ID 18 CONFIRMED v2 | PASS |

IT-R05 chủ động ném exception sau khi xác minh cả hai SKU đã ghi trong transaction; chứng minh rollback các bản ghi được đối chiếu, không phải kiểm thử mất điện/mất kết nối hoặc mọi lỗi giữa chừng. IT-R06 không sửa phiếu chưa có chứng từ nguồn; nhánh toàn hàng 0 có evidence đã liên kết mới được unit test, chưa thử trên MySQL trong kịch bản này. IT-R04 chứng minh cùng phiếu với hai transaction, không phải stress test hay bảo đảm chống trùng chứng từ nguồn xuyên nhiều Order/SKU. IT-R07 chưa kiểm thử giải phóng Order 12 ở lần đồng bộ nguồn sau. Hai kịch bản Bước 12 (cạnh tranh SKU cuối cùng có retry và rollback đơn nhiều SKU) đã PASS trước đó, được audit lại dữ liệu, không chạy lại transaction ghi trong Final Regression.

## 16. Đối chiếu dữ liệu đã lưu

Bước 13.6-I.2 và 13.7-A.1 truy vấn đọc độc lập, không gọi ReturnInventoryService để tạo kết quả. Hai lần audit đều PASS. Bảng dưới là kết quả thực tế tại lần cuối, không phải dữ liệu dự kiến.

| Variant | Tồn bán | Tồn nguồn | Version | Pending delta | Sync status |
|---:|---:|---:|---:|---:|---|
| 1 | 0 | 1 | 2 | -1 | PENDING |
| 2 | 10 | 10 | 1 | 0 | CONFIRMED |
| 3 | 1 | 1 | 1 | 0 | CONFIRMED |
| 4 | 12 | 12 | 4 | 0 | CONFIRMED |
| 5 | 13 | 13 | 4 | 0 | CONFIRMED |
| 6 | 12 | 12 | 4 | 0 | CONFIRMED |
| 7 | 12 | 12 | 4 | 0 | CONFIRMED |
| 8 | 10 | 10 | 3 | 0 | CONFIRMED |
| 9 | 10 | 10 | 3 | 0 | CONFIRMED |
| 10 | 10 | 10 | 3 | 0 | CONFIRMED |
| 11 | 10 | 12 | 5 | -2 | PENDING |

15 cặp movement/effect: 10 ORDER_CREATED, 5 RETURN_RECEIVED, tổng delta hàng hoàn +11; 13 effect CONFIRMED và 2 PENDING. Không có cặp ID 16/17 sau rollback. Hai pending là dữ liệu chủ đích; không sửa để ép tất cả thành CONFIRMED. MySQL AUTO_INCREMENT có thể nhảy ID sau rollback.

| Prisma model | Số bản ghi | Prisma model | Số bản ghi |
|---|---:|---|---:|
| User | 5 | Category | 3 |
| ColorGroup | 3 | Color | 3 |
| Size | 4 | Product | 10 |
| ProductVariant | 11 | Order | 9 |
| OrderItem | 10 | Inventory | 11 |
| InventoryMovement | 15 | PendingInventoryEffect | 15 |
| ReturnRequest | 6 | ReturnRequestItem | 7 |
| ReturnReceipt | 6 | ReturnReceiptItem | 7 |
| DeliveryReturnReceipt | 1 | DeliveryReturnItem | 1 |

## 17. Bằng chứng và hướng dẫn tái kiểm tra

| Mốc | Dấu hiệu trong log thực thi ngày 27/11/2026 |
|---|---|
| 13.5-G.1 | 17 suites / 511 tests PASS |
| 13.6-A.1 | Database preflight PASS |
| 13.6-B.2.1 | 7 fixture, 8 receipt lines, manifest ff7ceb8f, 18 model counts PASS |
| 13.6-C.1 / D.1 / E.1 | IT-R01 / IT-R02 / IT-R03 PASS |
| 13.6-F.1 / G.1 / H.1 | IT-R04 / IT-R05 / IT-R06 PASS |
| 13.6-I.1 | IT-R07 PENDING RECONCILIATION INTEGRATION PASS |
| 13.6-I.2 | Independent persisted database audit PASS |
| 13.7-A.1 | 511/511, 10/10 check-only, final database audit PASS, 47 protected files unchanged |

Báo cáo Jest: `m03-final-regression-6e2bf10b732c4a818893da75ea11c07b.json`; manifest `m03-return-fixtures-ff7ceb8f.json` (thư mục TEMP máy thực hiện). Các file này không phải tài nguyên commit Git; giữ riêng làm bằng chứng. SHA-256 manifest: `0274b795e885692f02cd011798939dd66a7ac9204e0e5eb59bf9431e466a6f35`. SHA-256 raw service ở lần nghiệm thu: `90626e10a6cdc522c9ea1adfb5e71ffaa353ef8a0bd8d963ed4f3e3f2127420a`. Các checksum cũ ở Mục 9 dùng quy tắc chuẩn hóa đã mô tả tại đó, không trộn với raw hash.

Kiểm tra offline (từ root repository, dependency đã cài):

```powershell
npx --no-install prisma validate
npx --no-install tsc --noEmit -p tsconfig.json
npx --no-install eslint "src/modules/inventory/**/*.ts"
$specs = @(Get-ChildItem src/modules/inventory -Filter '*.spec.ts' -File | Select-Object -ExpandProperty FullName)
npx --no-install jest --runTestsByPath $specs --runInBand
```

Mỗi lệnh cần kiểm tra exit code. 10 script được kiểm tra với `npx --no-install ts-node --typeCheck <duong-dan> --check-only`:

```text
scripts/test-order-inventory-concurrency.ts
scripts/test-order-inventory-rollback.ts
scripts/test-return-inventory-fixtures.ts
scripts/test-return-inventory-customer.ts
scripts/test-return-inventory-delivery.ts
scripts/test-return-inventory-replay.ts
scripts/test-return-inventory-concurrency.ts
scripts/test-return-inventory-rollback.ts
scripts/test-return-inventory-non-resalable.ts
scripts/test-return-inventory-pending.ts
```

Các script Integration Test hiện gắn với fixture/baseline cụ thể của lần chạy, không phải bộ test ghi có thể chạy lặp tùy ý. Không chạy lại mode ghi trên database đã nghiệm thu. Khi cần tái lập, tạo môi trường test độc lập mới theo quy trình được duyệt và điều chỉnh dữ liệu/manifest phù hợp; không reset database hiện tại. Script audit và final regression nằm ngoài repository (Downloads), không mặc định đưa vào PR. Audit chỉ đọc trên database test. Giữ nguyên `.env`, không tạo migration mới hoặc thay đổi dữ liệu Development.

## 18. Kết luận và điều kiện bàn giao

| Nhóm nhiệm vụ BE-02 | Trạng thái đề xuất |
|---|---|
| 1 — Danh mục/sản phẩm/thuộc tính/SKU | Đã nghiệm thu nội bộ trước Bước 13 |
| 2 — Sinh SKU duy nhất | Đã nghiệm thu nội bộ trước Bước 13 |
| 3 — Duyệt/tìm/lọc/sắp xếp | Đã nghiệm thu nội bộ trước Bước 13 |
| 4 — Bảng số đo | Đã nghiệm thu nội bộ trước Bước 13 |
| 5 — Tồn SKU/ledger/pending | Đã nghiệm thu nội bộ trước Bước 13; regression Inventory đạt |
| 6 — Điều chỉnh tồn/version/đối soát | Đã nghiệm thu nội bộ trước Bước 13; regression Inventory đạt |
| 7 — Tồn kho đơn hàng | Đạt có điều kiện: service, unit test và 2 kịch bản MySQL; còn M06/M07/M08 và hủy local-only trên MySQL |
| 8 — Tồn kho hàng hoàn | Đạt có điều kiện: service, unit test, 7 kịch bản MySQL và audit; còn M06/M08/M11 thực tế |

Trạng thái nhiệm vụ 1–6 kế thừa các mốc trước, không kiểm thử lại toàn bộ M02 ở Bước 13.7. Tổng hợp đề xuất: 8/8 có kết quả nội bộ (6 đã nghiệm thu, 2 có điều kiện), không đồng nghĩa 100% nghiệm thu chính thức hoặc sẵn sàng production. Không có xác nhận phê duyệt leader, merge hay triển khai. Các giới hạn Bước 12 ở Mục 10 vẫn có hiệu lực.

Các điều kiện cần thống nhất với M06/M08/M11 trước bàn giao tích hợp: guard chứng từ nguồn xuyên Order/SKU; bằng chứng nguồn được lưu bất biến và xác minh bởi M08; bảo toàn thứ tự khóa/caller transaction, điều kiện trạng thái và số lượng cộng dồn; xác minh lịch sử trừ tồn của đơn; sự kiện idempotent, xử lý trạng thái commit chưa rõ; không đưa hàng hỏng vào tồn bán nguồn; kiểm thử HTTP, authorization, hoàn tiền và các luồng liên module. Replay chưa lưu đủ toàn bộ snapshot nguồn lịch sử và không chứng nhận tất cả trường; nhánh không tăng tồn chưa lưu marker idempotency riêng. Không gọi KiotViet từ M03, không xem evidence giả lập là kết quả nguồn thật.

Phạm vi review PR: 31 file Inventory tại thời điểm Final Regression, `src/app.module.ts`, `prisma/schema.prisma`, migration mở rộng reason hiện có, 10 integration script nêu trên, 4 file HTTP E2E Inventory đã có và 2 tài liệu. Kiểm tra lại từng file trước stage; loại backup schema khỏi danh sách, review riêng seed-products-test.ts và test-concurrent-size-charts.mjs. Không đưa `.env`, TEMP manifest, báo cáo Jest hoặc bí mật vào Git. Không dùng `git add .`; git diff --check không bao phủ untracked. Bước cập nhật tài liệu chỉ thay đổi hai file Markdown; chưa stage/commit/push/migration.
