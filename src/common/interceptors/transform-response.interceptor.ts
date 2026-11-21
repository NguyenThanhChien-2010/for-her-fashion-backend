import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, map } from 'rxjs';
import type { Request, Response } from 'express';

export interface ApiSuccessResponse<T> {
  data: T;
  traceId: string;
}

export interface TraceableRequest extends Partial<Request> {
  id?: string | number;
  traceId?: string;
}

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
    if (context.getType() !== 'http') {
      return next.handle() as unknown as Observable<ApiSuccessResponse<T> | undefined>;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<TraceableRequest>();
    const response = http.getResponse<Response>();
    const traceId = resolveTraceId(request);

    response.setHeader('X-Request-ID', traceId);
    request.traceId = traceId;

    return next.handle().pipe(
      map((data: T) => {
        // 204 không được có response body.
        if (response.statusCode === 204) return undefined;
        return { data: data as T, traceId };
      }),
    );
  }
}
