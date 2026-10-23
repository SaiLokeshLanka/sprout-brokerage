import { BadRequestException } from '@nestjs/common';

/** Validates an optional Idempotency-Key header value. */
export function checkIdempotencyKey(key?: string) {
  if (key !== undefined && (key.length < 8 || key.length > 100)) {
    throw new BadRequestException('Idempotency-Key must be 8–100 characters');
  }
  return key;
}
