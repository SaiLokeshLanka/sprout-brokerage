import { Prisma } from '@prisma/client';

/** True when a write failed on a unique constraint (Prisma error P2002), optionally on a specific field. */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (!field) return true;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field);
}
