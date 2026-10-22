import { User } from '@prisma/client';

/**
 * The only shape of a user that ever leaves the API. Never return the raw
 * Prisma row — it contains passwordHash, the full PAN and lockout counters.
 */
export function toPublicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    kycStatus: u.kycStatus,
    panMasked: u.pan ? `XXXXXX${u.pan.slice(6)}` : null,
    dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString().slice(0, 10) : null,
    kycVerifiedAt: u.kycVerifiedAt,
    createdAt: u.createdAt,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;
