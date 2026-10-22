import { ConflictException, HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUser, toPublicUser } from '../users/user.mapper';
import { WalletService } from '../wallet/wallet.service';
import { LoginDto, RegisterDto } from './auth.dto';

const BCRYPT_ROUNDS = 10;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** A rotated-out refresh token replayed within this window is treated as a harmless race (e.g. two tabs). */
const REUSE_GRACE_MS = 30_000;
const INVALID_CREDENTIALS = 'Invalid email or password';
/** 423 Locked — not in Nest's HttpStatus enum. */
const HTTP_LOCKED = 423;

// Compared against when the email doesn't exist, so the response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', BCRYPT_ROUNDS);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface Session {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
}

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly wallet: WalletService,
  ) {}

  async register(dto: RegisterDto): Promise<Session> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      // User + wallet + welcome bonus are created atomically: never a user without a wallet.
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email: dto.email, fullName: dto.fullName, passwordHash } });
        await this.wallet.openAccount(tx, created.id);
        return created;
      });
      return this.startSession(user);
    } catch (err) {
      if (isUniqueViolation(err, 'email')) throw new ConflictException('An account with this email already exists');
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<Session> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw this.lockedError(user.lockedUntil);

    if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
      // Atomic increment, so parallel guesses can't slip past the limit.
      const { failedLoginCount } = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (failedLoginCount >= MAX_FAILED_LOGINS) {
        const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
        await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil } });
        this.logger.warn(`Account ${user.id} locked after ${MAX_FAILED_LOGINS} failed logins`);
        throw this.lockedError(lockedUntil);
      }
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }
    return this.startSession(user);
  }

  /** Exchanges a valid refresh token for a new session, revoking the old token (rotation). */
  async refresh(rawToken?: string): Promise<Session> {
    if (!rawToken) throw new UnauthorizedException('Not logged in');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!stored) throw new UnauthorizedException('Session expired');

    if (stored.revokedAt) {
      // An already-rotated token is being replayed. Outside the grace window this means
      // it was probably stolen, so end every session for this user.
      if (Date.now() - stored.revokedAt.getTime() > REUSE_GRACE_MS) {
        await this.revokeAllSessions(stored.userId);
        this.logger.warn(`Refresh token reuse detected for user ${stored.userId}; all sessions revoked`);
      }
      throw new UnauthorizedException('Session expired');
    }
    if (stored.expiresAt <= new Date()) throw new UnauthorizedException('Session expired');

    // Conditional revoke: if two refreshes race, only one wins.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedException('Session expired');

    return this.startSession(stored.user);
  }

  async logout(rawToken?: string) {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private revokeAllSessions(userId: string) {
    return this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async startSession(user: User): Promise<Session> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(48).toString('base64url');
    const ttlDays = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS', 7));
    const refreshExpiresAt = new Date(Date.now() + ttlDays * 86_400_000);
    // Only the hash is stored: a database leak doesn't leak usable tokens.
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt },
    });

    return { accessToken, refreshToken, refreshExpiresAt, user: toPublicUser(user) };
  }

  private lockedError(until: Date) {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return new HttpException(
      {
        statusCode: HTTP_LOCKED,
        error: 'Locked',
        message: `Too many failed attempts. Account locked — try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      },
      HTTP_LOCKED,
    );
  }
}
