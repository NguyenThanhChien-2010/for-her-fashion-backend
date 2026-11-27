# Hướng dẫn tích hợp M03 – M06

> **Bản cập nhật Bước 15.6-B (27/11/2026):** Mục 19 là kết quả hiện hành; Mục 1–18 là bằng chứng lịch sử. Hoàn tồn local-only đã đạt MySQL Integration 8/8, nhưng chưa nghiệm thu liên module thực tế.

> Cập nhật Bước 13.8 (27/11/2026): Mục 1–16 lưu nguyên nội dung Bước 12; hợp đồng hàng hoàn và thông tin hiện hành ở Mục 17–18 được ưu tiên khi có khác biệt, đặc biệt export module và số lượng test.

## 1. Thông tin tài liệu

- Dự án: For Her Fashion Backend.
- Phụ trách: BE-02; module cung cấp: M03 – Quản lý tồn kho; module sử dụng: M06 – Quản lý đơn hàng.
- Module liên quan: M07 – Thanh toán, M08 – Tích hợp KiotViet.
- Nhánh: `feature/be-02-m03`; commit nền tại thời điểm rà soát: `068d2a5`.
- Ngày: 27/11/2026.
- Trạng thái: Sẵn sàng rà soát tích hợp nội bộ có điều kiện; chưa xác minh tích hợp đầu cuối trong môi trường vận hành thực tế.

## 2. Phạm vi

M03 cung cấp chức năng kiểm tra tồn bán, trừ tồn trong giao dịch (transaction) và hoàn tồn có điều kiện đối với đơn hàng chỉ được xử lý nội bộ (local-only). M06 chịu trách nhiệm vòng đời đơn hàng và điều phối transaction giữa đơn hàng và tồn kho. M03 không tạo đơn hàng, xử lý thanh toán hoặc tự xác minh việc hủy đơn tại hệ thống nguồn. Nhánh được rà soát chưa có triển khai M06 hoặc M08 đã được xác minh.

## 3. Đăng ký module

File `src/modules/inventory/inventory.module.ts` export `InventoryService` và `OrderInventoryService`. Module sử dụng cần import `InventoryModule` và inject `OrderInventoryService`; không đăng ký trùng provider. Các service quản lý sổ biến động, tác động chờ và đối soát là provider nội bộ, hiện chưa được export.

Ví dụ đăng ký và tiêm phụ thuộc trong NestJS (không phải các class M06 đã tồn tại):

```typescript
@Module({
  imports: [InventoryModule],
  providers: [OrdersService],
})
export class OrdersModule {}
```

```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly orderInventory: OrderInventoryService,
) {}
```

## 4. Hợp đồng service công khai

Mã nguồn: `src/modules/inventory/order-inventory.service.ts` (các phương thức đã rà soát ở dòng 128, 198 và 383).

```typescript
interface StockRequestItem {
  variantId: number;
  quantity: number;
}

interface OrderStockResult {
  operationKey: string;
  variantId: number;
  movementId: string;
  pendingEffectId: string;
  inventoryVersion: number;
  delta: number;
  replayed: boolean;
}
```

ID và số lượng phải là số nguyên dương trong phạm vi số nguyên 32 bit có dấu. Danh sách sản phẩm không được rỗng. Các variant ID trùng nhau được gộp số lượng, kiểm tra tràn số và sắp xếp tăng dần. ID chứng từ và tác động chờ được trả về dưới dạng chuỗi; `inventoryVersion` khi gọi lại là version của nghiệp vụ đã ghi nhận, không nhất thiết là version hiện tại của tồn kho.

### 4.1. Kiểm tra tồn bán

```typescript
assertAvailable(items: StockRequestItem[]): Promise<void>;
```

Kiểm tra SKU đang hoạt động, sản phẩm có trạng thái `ACTIVE` và đủ số lượng tồn bán. Phương thức không giữ hàng, không ghi chứng từ biến động. Kết quả chỉ có tính kiểm tra sơ bộ; khi đặt hàng vẫn phải gọi `deductForOrder` trong transaction.

### 4.2. Trừ tồn khi tạo đơn hàng

```typescript
deductForOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<OrderStockResult[]>;
```

Đơn hàng và các chi tiết đơn hàng phải tồn tại trong transaction của bên gọi. Trạng thái đơn được phép: `AWAITING_PAYMENT`, `AWAITING_CONFIRMATION`; trạng thái giao hàng: `NOT_SHIPPED`.

Service khóa đơn hàng, chuẩn hóa chi tiết đơn, khóa các SKU theo ID tăng dần và kiểm tra nghiệp vụ đã ghi nhận. Với nghiệp vụ trừ tồn mới, service kiểm tra điều kiện hoạt động của sản phẩm/SKU, khóa bản ghi tồn kho, kiểm tra số lượng/version, giảm số lượng, tăng version, ghi chứng từ và tác động chờ. Nếu tồn kho đang ở trạng thái `NEEDS_RECONCILIATION` thì giữ nguyên trạng thái đó; nếu không, chuyển sang `PENDING`. Service không tự commit transaction. Phải truyền lỗi ra ngoài callback của transaction để rollback toàn bộ nghiệp vụ tạo đơn.

### 4.3. Hoàn tồn có điều kiện

```typescript
releaseForOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
  reason:
    | typeof InventoryReason.ORDER_CANCELLED
    | typeof InventoryReason.PAYMENT_EXPIRED,
  sourceDisposition: 'VERIFIED_LOCAL_ONLY',
): Promise<OrderStockResult[]>;
```

Yêu cầu đơn ở trạng thái `CANCELLED`, giao hàng `NOT_SHIPPED` và đã xác minh đơn chỉ được xử lý nội bộ. Chỉ hỗ trợ hai lý do đã nêu. Xem mục 8–10 về điều kiện thanh toán và hệ thống nguồn.

## 5. Transaction tạo đơn hàng

M06 xác thực yêu cầu, tính giá đáng tin cậy từ phía máy chủ và xử lý chống trùng yêu cầu (request-level idempotency). Kiểm tra tồn sơ bộ là tùy chọn. Tạo Order, OrderItem, gọi `deductForOrder` và lưu các bản ghi bắt buộc khác bằng cùng đối tượng `tx`. Chỉ commit khi tất cả thao tác thành công. Công việc liên quan hệ thống bên ngoài phải được điều phối qua cơ chế sau commit hoặc transactional outbox phù hợp.

Ví dụ cấu trúc transaction (M06 cần cung cấp `orderData`, `orderItems` đã xác thực; đây không phải triển khai checkout hoàn chỉnh):

```typescript
await prisma.$transaction(
  async (tx) => {
    const order = await tx.order.create({ data: orderData });
    await tx.orderItem.createMany({
      data: orderItems.map((item) => ({ ...item, orderId: order.id })),
    });
    const stockOperations = await orderInventory.deductForOrder(tx, order.id);
    return { order, stockOperations };
  },
  {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10000,
    timeout: 30000,
  },
);
```

Các giá trị timeout chỉ là ví dụ. Không dùng PrismaService gốc để sửa các bản ghi thuộc transaction, cũng không tạo transaction tồn kho độc lập. Không nuốt lỗi tồn kho hoặc thực hiện tác động bên ngoài không thể hoàn tác trong callback có thể được chạy lại.

## 6. Yêu cầu xử lý deadlock và retry

Bài kiểm thử cạnh tranh trên MySQL ghi nhận một lỗi `P2010` được điều kiện retry trong script phân loại là deadlock MySQL 1213. Log không in trực tiếp mã lỗi MySQL dạng số. Toàn bộ transaction thất bại được thử lại và trả về `INSUFFICIENT_STOCK`. Cơ chế retry trong M06 thực tế chưa được triển khai hoặc xác minh trên nhánh đã rà soát.

Ví dụ retry có giới hạn (cần import Prisma):

```typescript
function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (
    error.code === 'P2034' ||
    (error.code === 'P2010' && String(error.meta?.code) === '1213')
  );
}

async function withTransactionRetry<T>(run: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === maxAttempts) {
        throw error;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100 * attempt + Math.floor(Math.random() * 100));
      });
    }
  }
  throw new Error('Transaction retry limit exceeded');
}
```

Bọc toàn bộ transaction trong `run`, không chỉ riêng lệnh trừ tồn. Giữ nguyên idempotency key của yêu cầu khi thử lại; không retry mọi lỗi P2010 hoặc lỗi nghiệp vụ. Phối hợp thứ tự khóa giữa các module; tạo OrderItem trước khi lấy khóa độc quyền SKU có thể gây deadlock do nâng cấp khóa. `ReadCommitted` đã được cấu hình qua Prisma; thông tin isolation của session (`REPEATABLE-READ`) không phải phép xác minh độc lập isolation thực tế của transaction.

## 7. Chống thực hiện lặp nghiệp vụ tồn kho (Idempotency)

- Trừ tồn: `M03-ORDER-{orderId}-SKU-{variantId}-DEDUCT`.
- Hoàn tồn: `M03-ORDER-{orderId}-SKU-{variantId}-RELEASE`.

Hai lý do hoàn tồn sử dụng chung một key cho mỗi đơn/SKU. `InventoryLedgerService.findRecordedOperation` kiểm tra sự khớp nhau giữa chứng từ và tác động chờ; nghiệp vụ đã ghi nhận và khớp dữ liệu có thể trả về `replayed: true`; dữ liệu không nhất quán hoặc xung đột bị từ chối. `appendPendingMovement` ghi cả hai bản ghi trong transaction của bên gọi.

Không sửa số lượng chi tiết đơn sau khi trừ tồn nếu chưa thiết kế quy trình điều chỉnh phù hợp. Việc gọi lại vẫn phụ thuộc trạng thái đơn và các điều kiện xác thực; không đảm bảo mọi lần gọi lại sau khi đổi trạng thái đều thành công. M06 phải triển khai idempotency cấp yêu cầu riêng, bao gồm yêu cầu trùng đồng thời và truy xuất đơn đã commit.

## 8. Hủy đơn hàng nội bộ

M06 kiểm tra điều kiện hủy, trạng thái thanh toán/giao hàng, khóa đơn, ngăn gửi đơn ra hệ thống nguồn đồng thời, xác định đơn thực sự đủ điều kiện local-only và ghi nhận chuyển trạng thái/lịch sử hủy. Điều phối hoàn tồn trong ranh giới transaction đã thiết kế.

```typescript
await orderInventory.releaseForOrder(
  tx, orderId, InventoryReason.ORDER_CANCELLED, 'VERIFIED_LOCAL_ONLY',
);
```

Đơn hàng phải ở trạng thái `CANCELLED` và `NOT_SHIPPED` trong transaction. `VERIFIED_LOCAL_ONLY` phải dựa trên bằng chứng đáng tin cậy phía máy chủ, không nhận từ khách hàng và không tự động truyền cho mọi đơn bị hủy.

Nghiệp vụ hoàn tồn mới bị từ chối nếu có dấu vết đồng bộ bên ngoài (liên kết đơn KiotViet, sync outbox, sync log, hóa đơn nguồn liên quan). Phải có chứng từ trừ tồn gốc khớp và tác động chờ gốc phù hợp (`PENDING`, chưa giải phóng, chưa có xác nhận/mã chứng từ nguồn). Tồn kho cần đối soát không được hoàn tồn local mới. Chỉ riêng việc chưa có dấu vết không chứng minh rằng việc gửi đơn ra ngoài không thể xảy ra đồng thời; M06/M08 phải bảo đảm điều kiện này. Luồng hủy đơn thông thường không thay thế việc kiểm tra thanh toán/hoàn tiền.

## 9. Hết hạn thanh toán

M06 và M07 phối hợp xử lý hết hạn; thanh toán thất bại trước thời điểm hết hạn không tự động làm đơn bị hủy. Cần xác minh phương thức `MOMO`, trạng thái `UNPAID`, đã qua thời hạn thanh toán, chưa chuyển sang COD, không có giao dịch chưa xử lý dứt điểm hoặc thành công cản trở hoàn tồn, đơn `CANCELLED`, `NOT_SHIPPED` và đã xác minh local-only. Service còn kiểm tra dữ liệu tổng hợp thanh toán và các giao dịch thanh toán liên quan.

```typescript
await orderInventory.releaseForOrder(
  tx, orderId, InventoryReason.PAYMENT_EXPIRED, 'VERIFIED_LOCAL_ONLY',
);
```

`PaymentExpired` điều phối chuyển trạng thái hủy; luồng `OrderCancelled` chịu trách nhiệm điều phối hoàn tồn. Không gọi hai lý do như hai nghiệp vụ bù trừ độc lập. Nếu xử lý bất đồng bộ, phải thiết kế rõ cơ chế chuyển giao sự kiện tin cậy, idempotency, khôi phục lỗi và bảo đảm tính nhất quán. Với luồng local-only theo transaction, cần điều phối trạng thái, lịch sử và hoàn tồn trong ranh giới transaction dự kiến.

## 10. Ranh giới tích hợp KiotViet và tác động chờ

Trừ tồn local tạo chứng từ và tác động chờ với delta âm và cùng key; hoàn tồn local tạo chứng từ và tác động chờ bù trừ với delta dương. Cả hai không trực tiếp thay đổi `sourceQuantity`. Luồng hoàn tồn local hiện tại không tự kết thúc cặp tác động trừ/hoàn tồn gốc. Cần thống nhất với M08 vòng đời của cặp tác động chờ có tổng delta bằng 0; không xóa hoặc xác nhận sai các tác động chờ.

`PendingInventoryEffectService.releaseConfirmed` yêu cầu bằng chứng nguồn đã xác minh qua M08, định danh/version chính xác, khóa SKU và đối soát số lượng nguồn cùng các tác động còn lại trong cùng transaction. Không commit phương thức này riêng lẻ. `InventoryReconciliationService.confirmAdjustment` là luồng xác nhận điều chỉnh tồn kho, không phải luồng đồng bộ đơn hàng tổng quát. Các provider nội bộ này hiện chưa được export.

Đơn đã đồng bộ nguồn cần một luồng hủy và đối soát riêng dựa trên trạng thái nguồn đã xác minh; nằm ngoài phạm vi hoàn tồn local-only đã được kiểm chứng.

## 11. Xử lý lỗi

| Mã lỗi service | HTTP status của exception | Hành động của bên sử dụng |
|---|---:|---|
| VALIDATION_ERROR | 400 | Từ chối dữ liệu không hợp lệ |
| NOT_FOUND | 404 | Báo không tìm thấy tài nguyên |
| INSUFFICIENT_STOCK | 409 | Thông báo không đủ tồn bán |
| CONFLICT | 409 | Kiểm tra xung đột trạng thái hoặc tính nhất quán |
| VERSION_CONFLICT | 409 | Xử lý theo ngữ cảnh nghiệp vụ |

Đây là exception ở cấp service, chưa phải phản hồi HTTP M06 đã được xác minh. `INSUFFICIENT_STOCK` được trả qua payload của exception dù không có trong hằng `ErrorCode` dùng chung. Cần giữ nguyên mã lỗi qua controller/global exception filter và kiểm thử phản hồi thực tế đầu cuối.

## 12. Yêu cầu cơ sở dữ liệu

MySQL 8.0, bảng InnoDB, `Inventory.variantId` duy nhất và `operationKey` duy nhất trong cả `InventoryMovement` và `PendingInventoryEffect`. Migration hiện có `20261127000000_expand_inventory_adjustment_reason` mở rộng `inventory_adjustments.reason` từ VARCHAR(500) thành VARCHAR(2000). Cả năm migration hiện có đã được áp dụng vào database kiểm thử độc lập. Chưa xác minh trạng thái migration trên database Development hoặc triển khai thực tế trong lần bàn giao này. Không tạo migration trùng; tuân thủ quy trình triển khai được nhóm phê duyệt.

## 13. Kết quả kiểm thử đã xác minh

| Hạng mục | Kết quả |
|---|---|
| Kiểm thử hồi quy Inventory | 9/9 bộ test; 280/280 test đạt |
| OrderInventoryService | 28 unit test, đã tính trong 280 |
| Dependency Injection InventoryModule | 4 test, đã tính trong 280 |
| TypeScript dự án, ESLint Inventory, Prisma validate | PASS |
| Cạnh tranh SKU cuối cùng | 10/10 tiêu chí; 2 kết nối, 1 commit, 1 từ chối, 1 retry |
| Gọi lại nghiệp vụ trừ tồn | PASS; quantity 0, version 2, một movement/effect |
| Rollback nhiều SKU | 10/10 tiêu chí; SKU-A 10 → 7 → 10, SKU-B 1; version khôi phục về 1 |
| Xác minh database độc lập | 2/2; không lưu đơn, chi tiết đơn, movement hoặc effect thuộc transaction thất bại |

File kiểm thử: `scripts/test-order-inventory-concurrency.ts` và `scripts/test-order-inventory-rollback.ts`. Chỉ kiểm tra kiểu dữ liệu (không ghi dữ liệu giả lập):

```powershell
npx --no-install ts-node --typeCheck scripts/test-order-inventory-concurrency.ts --check-only
npx --no-install ts-node --typeCheck scripts/test-order-inventory-rollback.ts --check-only
```

Thực thi Integration Test yêu cầu cấu hình database kiểm thử độc lập ở port 3308, xác minh hostname và cấp phép rõ ràng. Không chạy trên Development port 3307. Kết quả là bằng chứng từ các lần chạy đã ghi nhận, không chứng minh mọi kịch bản cạnh tranh đều an toàn.

## 14. Các rủi ro tích hợp còn tồn đọng

| Mã | Rủi ro | Công việc tiếp theo |
|---|---|---|
| R01 | Kiểm tra tồn không giữ hàng | Trừ tồn trong transaction checkout |
| R02 | Deadlock transaction | M06 retry toàn bộ transaction có giới hạn |
| R03 | Hủy đơn theo trạng thái nguồn | Phối hợp M08 |
| R04 | Vòng đời cặp tác động chờ có tổng delta bằng 0 | Thống nhất chính sách đối soát |
| R05 | Thay đổi trạng thái sản phẩm đồng thời | Kiểm thử cạnh tranh bổ sung |
| R06 | Quy tắc thanh toán khi hủy đơn thông thường | M06/M07 kiểm tra |
| R07 | Chưa có tích hợp M06/M08 thực tế | Kiểm thử đầu cuối |
| R08 | Cấu trúc phản hồi lỗi HTTP | Kiểm thử controller và exception filter |
| R09 | Gọi lại sau khi đổi trạng thái đơn | Định nghĩa và kiểm thử phạm vi hỗ trợ |
| R10 | Hoàn tồn local trên MySQL thật | Bổ sung Integration Test hủy đơn và hết hạn |
| R11 | Yêu cầu checkout trùng | Xác minh idempotency cấp yêu cầu của M06 |

## 15. Danh sách công việc bàn giao cho M06

- [ ] Import InventoryModule; inject OrderInventoryService.
- [ ] Kiểm tra chuyển trạng thái đơn hàng, thanh toán và giao hàng.
- [ ] Triển khai idempotency cấp yêu cầu checkout.
- [ ] Dùng cùng một transaction cho Order, OrderItem và trừ tồn.
- [ ] Cấu hình isolation/timeout đã được phê duyệt và retry có giới hạn.
- [ ] Bảo toàn ngữ nghĩa phản hồi HTTP INSUFFICIENT_STOCK.
- [ ] Điều phối hủy đơn, xác minh local-only và ngăn gửi đơn ra nguồn đồng thời.
- [ ] Bảo đảm hoàn tồn tối đa một lần; phối hợp M08 hủy đơn dựa trên trạng thái nguồn.
- [ ] Thống nhất vòng đời tác động chờ.
- [ ] Chạy kiểm thử tích hợp M03/M06/M07/M08 và được phê duyệt.

## 16. Kết luận nghiệm thu

Các phương thức nền tảng của M03 phục vụ tồn kho đơn hàng đã sẵn sàng để rà soát tích hợp nội bộ có điều kiện. Trừ tồn, gọi lại nghiệp vụ trừ tồn, cạnh tranh SKU cuối cùng có retry và rollback nhiều SKU đã đạt trong các kịch bản được ghi nhận. Hoàn tồn local-only đã được hỗ trợ và kiểm thử unit test, nhưng chưa kiểm chứng trực tiếp trên MySQL thật trong các lần chạy này. Tài liệu bàn giao không chứng nhận sẵn sàng vận hành thực tế, toàn bộ kịch bản cạnh tranh, luồng hủy đơn hoàn chỉnh hoặc tích hợp đầu cuối M06/M07/M08.

---

## 17. Cập nhật Bước 13 — tích hợp hàng hoàn M03/M06/M08/M11

**Phiên bản bàn giao nội bộ ngày 27/11/2026.** Các mục 1–16 là hồ sơ Bước 12 về tồn kho đơn hàng; phần này bổ sung hợp đồng hiện hành. M03 đã bổ sung `ReturnInventoryService` và kiểm thử nội bộ. M06/M08/M11 thực tế chưa được nghiệm thu đầu cuối. Không coi việc nhận hàng vật lý là đủ điều kiện tự động tăng tồn bán.

### 17.1. Phân công trách nhiệm

| Module | Trách nhiệm và ranh giới |
|---|---|
| M06 — Đơn hàng | Quản lý trạng thái đơn, giao hàng thất bại, lập phiếu `DeliveryReturnReceipt` và chi tiết; phối hợp khóa Order, đảm bảo hàng đã nhận lại và phân loại. |
| M11 — Đổi trả | Quản lý yêu cầu, duyệt, kiểm nhận và `ReturnReceipt`/`ReturnReceiptItem`; phân biệt thực nhận, chấp nhận và bán lại; kiểm soát cộng dồn và trạng thái. |
| M08 — KiotViet | Xác minh chứng từ nguồn thực tế, ánh xạ SKU, số lượng, snapshot và từng tác động chờ; điều phối độc quyền theo chứng từ nguồn, cả khi khác Order/SKU. Lưu bằng chứng gốc bền vững để replay. |
| M03 — Tồn kho | Kiểm tra dữ liệu phiếu và bằng chứng đã xác minh, khóa bản ghi, đối soát tồn bán, ghi ledger/effect đúng một lần trong transaction của caller. Không gọi API KiotViet. |
| M07/M09/M13 | Thanh toán/hoàn tiền, nghiệp vụ doanh thu và thông báo theo hợp đồng liên module; mỗi consumer chịu trách nhiệm idempotency riêng. Không suy ra hoàn tiền từ việc tăng tồn. |

M06/M11 chịu trách nhiệm xác minh lịch sử trừ tồn hợp lệ, quyền thao tác, tính bất biến của phiếu đã ghi nhận, và trạng thái chính xác. M03 không tự chứng minh đơn gốc đã trừ tồn trong mọi trường hợp. Cần thiết kế cơ chế phục hồi khi nguồn đã xử lý nhưng transaction nội bộ thất bại; không phát hành lại chứng từ nguồn một cách mù quáng.

### 17.2. Đăng ký và API nội bộ

`InventoryModule` hiện export `InventoryService`, `OrderInventoryService` **và `ReturnInventoryService`** (thay thế thông tin export ở Mục 3). Module gọi import `InventoryModule` và inject service, không khai báo provider trùng. `InventoryLedgerService` và `PendingInventoryEffectService` vẫn là chi tiết triển khai nội bộ. Mã nguồn chính: `src/modules/inventory/return-inventory.service.ts` và `return-inventory.contract.ts`.

```typescript
// Chữ ký hợp đồng, không phải controller HTTP.
prepareReceipt(tx: Prisma.TransactionClient, kind: ReturnReceiptKind,
  receiptId: number): Promise<PreparedReturnReceipt>;
prepareSourceReconciliation(tx: Prisma.TransactionClient, kind: ReturnReceiptKind,
  receiptId: number, evidence: VerifiedReturnEvidence): Promise<PreparedReturnReconciliation>;
applyVerifiedReturn(tx: Prisma.TransactionClient, kind: ReturnReceiptKind,
  receiptId: number, evidence: VerifiedReturnEvidence): Promise<ReturnStockResult[]>;
validateNonResalableReturn(tx: Prisma.TransactionClient, kind: ReturnReceiptKind,
  receiptId: number): Promise<NonResalableReturnResult>;
```

`prepareReceipt` kiểm tra và khóa phiếu, không ghi tồn. `validateSourceEvidence` kiểm tra cấu trúc và sự tương thích giữa phiếu với evidence, không xác minh nguồn thật. `prepareSourceReconciliation` chỉ chuẩn bị cho lần áp dụng mới, không hỗ trợ replay; kế hoạch chỉ có giá trị trong cùng transaction giữ khóa. Caller thông thường gọi trực tiếp `applyVerifiedReturn`, không tái sử dụng kế hoạch đã đọc ở transaction trước.

### 17.3. Điều kiện phiếu và số lượng

| Điều kiện | CUSTOMER_RETURN | DELIVERY_RETURN |
|---|---|---|
| Order status | DELIVERED | DELIVERY_UNSUCCESSFUL |
| Delivery status | DELIVERED | RETURNED |
| ReturnRequest status | RECEIVED hoặc COMPLETED | Không áp dụng |
| Bảng phiếu/chi tiết | return_receipts / return_receipt_items | delivery_return_receipts / delivery_return_items |
| Actor | Bắt buộc | Có thể null |
| Chứng từ nguồn | Cần khớp phiếu khi áp dụng evidence; có thể null cho luồng không tăng tồn | Bắt buộc |
| Số lượng | 0 ≤ resalable ≤ accepted ≤ received; accepted ≤ approved ≤ requested ≤ ordered | 0 ≤ resalable ≤ received ≤ ordered |

ID là số nguyên dương; số lượng là số nguyên không âm trong giới hạn Int có dấu 32 bit. Phiếu phải có ít nhất một dòng thực nhận dương; từng dòng thuộc đúng đơn, SKU và yêu cầu tương ứng. Thời điểm nhận phải hợp lệ và không ở tương lai. Cộng dồn: tổng accepted của các phiếu khách trả theo request item không vượt approved; tổng customer accepted và delivery received theo order item không vượt ordered. Đây là quy tắc hiện hành của M03, cần M06/M11 thống nhất cách xử lý hàng bị từ chối có thể được trình lại. Không sửa hoặc xóa chi tiết lịch sử để tránh giới hạn cộng dồn.

### 17.4. Hợp đồng bằng chứng nguồn

```typescript
// return-inventory.contract.ts
export type ReturnReceiptKind = 'CUSTOMER_RETURN' | 'DELIVERY_RETURN';
export interface UnreflectedPendingEffect {
  operationKey: string;
  expectedVersion: number;
}
export interface VerifiedReturnSourceSnapshot {
  variantId: number;
  sourceVariantId: string;
  expectedInventoryVersion: number;
  restockedQuantity: number;
  sourceQuantity: number;
  sourceVersion: string;
  observedAt: Date;
  confirmedEffects: VerifiedPendingEffect[];
  notReflectedEffects: UnreflectedPendingEffect[];
}
export interface VerifiedReturnEvidence {
  receiptKind: ReturnReceiptKind;
  receiptId: number;
  sourceDocumentId: string;
  snapshots: VerifiedReturnSourceSnapshot[];
}
// VerifiedPendingEffect có operationKey, expectedVersion, sourceDocumentId.
```

M08 cung cấp evidence từ luồng server tin cậy, **không nhận payload này trực tiếp từ HTTP/client**. `sourceDocumentId` phải khớp liên kết trên phiếu và không được tái sử dụng cho phiếu khác. `sourceVariantId` khớp `ProductVariant.kiotvietVariantId`; một snapshot cho mỗi SKU có tổng resalable dương, không trùng SKU nguồn/đích, không thêm snapshot cho dòng 0. `restockedQuantity` đúng tổng resalable của SKU. `sourceQuantity` đã bao gồm lượng hàng hoàn phản ánh tại nguồn; `observedAt` là Date hợp lệ, không trước `receivedAt`, không sau hiện tại. Khi áp dụng mới, observedAt phải mới hơn lastConfirmedAt (nếu có), sourceVersion khác version nguồn cũ và expectedInventoryVersion khớp version nội bộ; không giả định sourceVersion là số tăng dần.

Mỗi tác động chưa giải phóng phải được phân loại đúng một lần vào `confirmedEffects` (đã phản ánh tại nguồn) hoặc `notReflectedEffects` (chưa phản ánh); không được trùng, thiếu hay thừa. M03 kiểm tra ledger/effect và expectedVersion, từ chối trường hợp thiếu bằng chứng hoặc mâu thuẫn. Giới hạn chuỗi: sourceVariantId 64, sourceDocumentId/sourceVersion 100, operationKey 191; không chấp nhận khoảng trắng thừa ở đầu/cuối. Khi deserialize JSON, khôi phục `observedAt` thành Date.

### 17.5. Quy trình transaction và chống ghi trùng

1. Module gọi xác minh điều kiện nghiệp vụ và phối hợp M08 xác minh nguồn bên ngoài transaction DB kéo dài; chuẩn bị evidence và giữ cơ chế độc quyền theo chứng từ nguồn xuyên suốt liên kết/ghi nhận/replay.
2. Trong transaction `ReadCommitted`, khóa Order trước khi cập nhật trạng thái và phiếu; lưu trạng thái/phiếu/chi tiết phù hợp, liên kết chứng từ đã xác minh. Tuân thủ thứ tự khóa chung: Order → ReturnRequest (nếu có) → receipt → ProductVariant/Inventory theo variantId tăng dần.
3. Gọi service bằng chính `tx`; không tự mở transaction riêng trong M03. Bất kỳ exception nào phải thoát callback để rollback toàn bộ. Không gọi API KiotViet trong callback DB hoặc retry mù khi kết quả commit chưa rõ.
4. Với hàng bán lại, đối soát snapshot, release các effect đã phản ánh, cập nhật Inventory bằng điều kiện version/quantity, ghi Movement và Effect rồi xác nhận Effect hàng hoàn trong cùng transaction. Commit chỉ sau khi các thao tác bắt buộc đều thành công.
5. Sau commit mới phát hành sự kiện theo thiết kế đã thống nhất (cần đảm bảo lưu/dispatch sự kiện tin cậy và idempotency cấp consumer). Replay giữ nguyên nghiệp vụ lịch sử, không phát lại tác động kinh tế.

Ví dụ minh họa phần gọi M03, không phải implementation M06/M08/M11 hiện có; `persistReceiptAndState` dưới đây là hàm caller phải triển khai, tuân thủ khóa/điều kiện nêu trên. Guard chứng từ nguồn phải được giữ bên ngoài đoạn này:

```typescript
const result = await prisma.$transaction(async (tx) => {
  await persistReceiptAndState(tx); // caller thực hiện đúng quy ước khóa
  return returnInventory.applyVerifiedReturn(tx, kind, receiptId, evidence);
}, {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10000,
  timeout: 30000,
});
```

Thông số chờ/timeout là giá trị đã dùng trong bài test, không phải SLA vận hành. Khi deadlock, chỉ retry transaction toàn bộ có giới hạn với cùng business key sau khi phân loại lỗi và xác minh trạng thái/evidence phù hợp. Không retry riêng từng lần ghi tồn.

### 17.6. Công thức đối soát và ledger

`projectedQuantity = max(0, sourceQuantity + sum(delta của effect chưa phản ánh))`. Tính tổng bằng BigInt và kiểm tra giới hạn Int; nếu giá trị âm hoặc có effect chưa phản ánh cần đối soát, trạng thái dự kiến NEEDS_RECONCILIATION; nếu còn effect chưa phản ánh thì PENDING, còn lại CONFIRMED. `applyVerifiedReturn` còn yêu cầu `projectedQuantity - previousQuantity === restockedQuantity` cho mọi SKU trước khi ghi; drift khác phải được xử lý bằng nghiệp vụ đối soát riêng, không tự gán vào hàng hoàn.

| Thành phần | Quy tắc |
|---|---|
| Inventory | Gán tồn dự kiến, sourceQuantity/sourceVersion/lastConfirmedAt/syncStatus; version tăng 1 cho mỗi SKU có hàng bán lại |
| Movement | RETURN_RECEIVED; delta = resalable của từng dòng dương; refType = RETURN_RECEIPT_ITEM hoặc DELIVERY_RETURN_ITEM; refId = receipt item ID; createdBy theo actor |
| Pending Effect hàng hoàn | Cùng key/variant/delta; orderId của đơn gốc; tạo version 1 rồi xác nhận version 2 trong cùng transaction, lưu chứng từ và thời điểm xác nhận |
| Effect đã phản ánh khác | Release theo evidence đã xác minh; không tính lại delta đã nằm trong tồn nguồn |
| Effect chưa phản ánh | Giữ nguyên, đưa delta vào phép tính tồn bán |

Operation key: `M03-RETURN-RECEIPT-ITEM-{receiptItemId}-RESTOCK` hoặc `M03-DELIVERY-RETURN-ITEM-{receiptItemId}-RESTOCK`. Unique key ở cả movement và effect. Một SKU có nhiều dòng dương có thể có nhiều movement cùng inventoryVersion; không giả định version là khóa duy nhất của movement. `ReturnStockResult` mở rộng `RecordedInventoryOperation` với `receiptKind`, `receiptItemId`, `replayed`; movementId và pendingEffectId là chuỗi.

Ví dụ IT-R07: tồn bán 8, tồn nguồn 10, effect đơn 12 −2 chưa phản ánh; nguồn sau hoàn 12, tồn bán mới 10, version 4 → 5; effect hàng hoàn +2 CONFIRMED, effect đơn 12 vẫn PENDING. Không cộng thêm +2 vào snapshot nguồn lần nữa.

### 17.7. Replay và phiếu không bán lại

Replay kiểm tra lại điều kiện phiếu và evidence, quyền sở hữu chứng từ; tìm đúng đủ cặp ledger/effect theo key, chứng từ, trạng thái CONFIRMED, thời điểm xác nhận gốc, inventoryVersion lịch sử = expectedInventoryVersion gốc + 1; ledger kiểm tra delta, Order, SKU, reason, ref, actor và note. Trả lại ID lịch sử với `replayed: true`, không ghi tồn. Không tạo thêm bản ghi để vá ledger thiếu một nửa hoặc thừa. Không dùng version tồn hiện tại thay cho version gốc.

Giới hạn: M03 chưa lưu toàn bộ payload nguồn lịch sử (sourceQuantity, sourceVersion, mapping, danh sách effect); replay không chứng nhận đầy đủ các trường này và không áp dụng lại snapshot. M08 cần lưu evidence bất biến và xác minh đúng chứng từ; nếu không khớp cần xử lý xung đột, không tự tăng tồn. Kiểm tra effect.version lịch sử và thứ tự timestamp release/ack chưa phải điều kiện đầy đủ của replay hiện hành; không suy diễn xác thực tuyệt đối.

Nếu mọi dòng resalable = 0, gọi `validateNonResalableReturn` với phiếu đã lưu: trả `NO_STOCK_CHANGE`, restockedQuantity 0; không tạo movement/effect hoặc tăng version. Customer return có thể chưa có chứng từ tăng tồn; delivery return phải có chứng từ. Service từ chối phiếu dương đi qua nhánh này và từ chối phiếu có ledger cũ mâu thuẫn. Nếu đã liên kết evidence hợp lệ với snapshots rỗng, `applyVerifiedReturn` có thể trả `[]` cho phiếu toàn dòng 0. Không gọi apply với evidence giả/null để bỏ qua nguồn. Nhánh 0 không tạo dấu idempotency bền vững riêng; M06/M11 phải giữ phiếu bất biến và chống xử lý lại sự kiện. M08 vẫn kiểm soát hàng hỏng không nhập tồn bán nguồn.

### 17.8. Lỗi và điều kiện nghiệm thu liên module

| Lỗi service | HTTP tương ứng | Xử lý caller |
|---|---:|---|
| BAD_REQUEST | 400 | Dữ liệu sai kiểu, thiếu trường, trùng phân loại; sửa hợp đồng |
| NOT_FOUND | 404 | Phiếu/Order/SKU/tồn không tồn tại; kiểm tra liên kết |
| CONFLICT | 409 | Trạng thái, cộng dồn, chứng từ, replay, nguồn hoặc ledger mâu thuẫn; dừng và đối soát |
| VERSION_CONFLICT | 409 | Version tồn/effect thay đổi; đánh giá lại trạng thái, không ghi đè |

Đây là exception cấp service, chưa xác minh HTTP qua controller M06/M11. Điều phối độc quyền chứng từ nguồn giữa nhiều Order/SKU chưa có bảo đảm unique cross-table tại DB; kiểm tra ownership của service không thay thế guard M08. Cần kiểm thử nguồn thật, mapping, trạng thái, replay sau thay đổi trạng thái, deadlock/timeout, xử lý mất kết nối lúc commit, idempotency sự kiện, quyền, thanh toán/hoàn tiền, và luồng hủy đơn local-only trên MySQL thật. Không chứng nhận production.

## 18. Kết quả bàn giao hiện hành

Final Regression Bước 13.7-A.1: Prisma validate, TypeScript, ESLint PASS; 17 suite/511 unit test đạt, không failed/pending/todo; 10 integration script check-only đạt; 7 kịch bản hàng hoàn và 2 kịch bản đơn hàng MySQL đã nghiệm thu nội bộ, audit độc lập đọc lại đạt. 280 test ở Mục 13 là mốc lịch sử, đã nằm trong 511. Xem [báo cáo nghiệm thu](M03_TEST_ACCEPTANCE_REPORT.md) phần cập nhật Bước 13 để biết kết quả và giới hạn. Chờ leader và các module liên quan duyệt hợp đồng trước khi tích hợp/merge.
## 19. Cập nhật Bước 15 — kết quả kiểm thử hoàn tồn và điều kiện tích hợp (27/11/2026)

Mục 1–18 được giữ làm lịch sử; phần này thay thế các nhận định trước đây rằng `releaseForOrder()` chưa được kiểm thử trên MySQL thật. HEAD tại thời điểm kiểm tra: `1c02e7a145b518f20f3d7eb6c83e67b7f468c0ef`, cùng các bản sửa M02 chưa commit. Hợp đồng service tại các mục 4, 8–10, 17 không thay đổi.

### 19.1. Trạng thái hiện hành

- 15.6-A: 31 suite, 768/768 unit test (M02 257, M03 511), Prisma validate, TypeScript và ESLint BE-02 PASS.
- 15.3: 16 suite, 292/292 HTTP E2E với Prisma giả lập, 28/28 API có mẫu success đúng schema, 0 response finding.
- 15.1-D.2: 136/136 kiểm tra phân quyền, guard thật và JWT strategy test; không chứng nhận xác thực phiên thật BE-01.
- 15.4-C: 8/8 kịch bản release/audit trên MySQL test 3308 với bằng chứng nguồn giả lập. Hủy COD, hết hạn MOMO, replay cùng/khác reason, hai transaction đồng thời, rollback hai SKU, từ chối khi có dấu vết nguồn, từ chối trạng thái đơn sai và audit dữ liệu đã commit đều PASS. R10 tại mục 14 được xử lý trong phạm vi này.
- Bước 12 và 13: 2 kịch bản đơn hàng và 7 kịch bản hàng hoàn MySQL thật đã đạt; không chạy lại các transaction ghi dữ liệu.

### 19.2. Ràng buộc phía caller

M04 (giỏ hàng/Mua ngay) chỉ gọi `assertAvailable()`; không giữ hoặc trừ tồn. M06 phải điều phối Order/OrderItem, `deductForOrder()` và các nghiệp vụ liên quan trong cùng transaction. Khi hủy/timeout, M06/M07 phải xác minh điều kiện thanh toán, chuyển trạng thái phù hợp trong cùng transaction và phối hợp M08 ngăn dispatch đồng thời trước khi gọi `releaseForOrder()`. Chỉ dùng `VERIFIED_LOCAL_ONLY` khi có căn cứ tin cậy, không nhận giá trị này từ client. Không catch lỗi rồi commit một phần. Retry có giới hạn cho toàn transaction theo hợp đồng idempotency của caller.

Các reason `ORDER_CANCELLED` và `PAYMENT_EXPIRED` dùng chung key `M03-ORDER-{orderId}-SKU-{variantId}-RELEASE`. Replay có kiểm tra chứng từ gốc, không phải cấp phép bỏ qua điều kiện trạng thái/ thanh toán. Hai effect trừ và hoàn có tổng delta 0 vẫn có thể PENDING; không tự xác nhận nguồn hoặc đánh dấu released chỉ dựa trên tổng delta. Đơn có dấu vết đồng bộ bị từ chối hoàn local mới; cần đối soát nguồn M08. M11 cung cấp kết quả kiểm nhận và số lượng bán lại, M08 xác minh chứng từ. Không gọi KiotViet/MoMo thật từ script kiểm thử.

### 19.3. Checklist tích hợp cần xác nhận cùng nhóm

| Module | Điều kiện chưa nghiệm thu đầu cuối |
|---|---|
| M04 | Cart và Buy Now thực tế không ghi Inventory/Movement/Effect |
| M06 | Hai checkout tranh SKU cuối; idempotency cấp Order; rollback cùng nghiệp vụ ưu đãi/outbox; hủy đơn theo trạng thái đã xác minh |
| M07 | Timeout, thu muộn, chuyển COD, hoàn tiền, đối soát thanh toán thật |
| M08 | Xác minh local-only, chống dispatch đồng thời, guard chứng từ xuyên Order/SKU, xử lý replay/timeout và pending effects theo nguồn |
| M11 | Kiểm nhận bán lại thật, số lượng lũy kế và xử lý event idempotent liên module |
| BE-01/leader | Thống nhất HTTP 503 generic so với ví dụ DEPENDENCY_UNAVAILABLE; kiểm thử auth thật |

Xem [báo cáo nghiệm thu](M03_TEST_ACCEPTANCE_REPORT.md), mục 19, để biết số liệu và hash báo cáo. Các gói audit Bước 15 chạy từ TEMP, không phải script đã commit. Kết quả nội bộ không thay thế nghiệm thu liên module, phê duyệt PR hoặc production. Không chạy lại fixture MySQL 15.4-B/C trên dữ liệu đã commit.
