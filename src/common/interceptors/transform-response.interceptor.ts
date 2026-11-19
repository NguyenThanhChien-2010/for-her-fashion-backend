import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, map } from 'rxjs';
import type { Request, Response } from 'express';

// Response envelope chính thức theo API Contract v1.0.2 (tag M01 + Shared):
// thành công -> { data, traceId }; mọi response đều set header X-Request-ID.
// HTTP 204 (ví dụ POST /auth/logout) không có body nên interceptor trả undefined để Nest kết thúc response.
export interface ApiSuccessResponse<T> {
  data: T;
  traceId: string;
}

// Request đã được interceptor/filter gắn traceId; req.id do nestjs-pino tạo cho mỗi request.
export interface TraceableRequest extends Partial<Request> {
  id?: string | number;
  traceId?: string;
}

// Một traceId duy nhất xuyên suốt request: ưu tiên x-request-id của client, rồi req.id của Pino, cuối cùng randomUUID.
// Hàm thuần nên filter gọi lại vẫn ra cùng giá trị khi request đã có header hoặc req.id.
export function resolveTraceId(request: TraceableRequest): string {
  const header = request.headers?.['x-request-id'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }
  if (typeof request.traceId === 'string' && request.traceId.trim()) {
    return request.traceId.trim();
  }
  const requestId = request.id;
  if (typeof requestId === 'string' && requestId.trim()) return requestId.trim();
  if (typeof requestId === 'number') return String(requestId);
  return randomUUID();
}

@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T> | undefined>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T> | undefined> {
    // Ngoài HTTP (RPC/WS nếu bật sau này) không bọc envelope; chỉ HTTP mới có contract { data, traceId }.
    if (context.getType() !== 'http') {
      return next.handle() as unknown as Observable<ApiSuccessResponse<T> | undefined>;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<TraceableRequest>();
    const response = http.getResponse<Response>();
    const traceId = resolveTraceId(request);

    // Header phải được set cho mọi response, kể cả 204; filter lỗi đọc lại traceId này để đồng bộ log với client.
    response.setHeader('X-Request-ID', traceId);
    request.traceId = traceId;

    return next.handle().pipe(
      map((data: T) => {
        // 204 No Content: không được ghi body, nếu không Express sẽ ném lỗi body trên status 204.
        if (response.statusCode === 204) return undefined;
        return { data: data as T, traceId };
      }),
    );
  }
}
