/**
 * Uniform API error envelope (matches ApiError in @zios/shared-types):
 * every non-2xx response body is { statusCode, code, message, ...extra }.
 */
import { HttpException } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super({ statusCode: status, code, message, ...extra }, status);
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 400 VALIDATION_ERROR unless the value is a well-formed email address. */
export function assertValidEmail(email: unknown): asserts email is string {
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
    throw new ApiException(400, 'VALIDATION_ERROR', 'a valid email address is required');
  }
}
