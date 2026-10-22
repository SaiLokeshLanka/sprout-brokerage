import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JournalEntry, LedgerEntry, Prisma } from '@prisma/client';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientFundsError, openUserCashAccount, postJournal, SYSTEM_BANK_ACCOUNT_ID } from './ledger';

type MoveType = 'DEPOSIT' | 'WITHDRAWAL';

const DESCRIPTIONS: Record<MoveType, string> = {
  DEPOSIT: 'Added money (virtual)',
  WITHDRAWAL: 'Withdrawn to bank (virtual)',
};

const abs = (n: bigint) => (n < 0n ? -n : n);

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Called inside the registration transaction: new user → cash account + welcome bonus. */
  openAccount(tx: Prisma.TransactionClient, userId: string) {
    const bonusRupees = Number(this.config.get('WELCOME_BONUS_RUPEES', 100_000));
    return openUserCashAccount(tx, userId, BigInt(Math.round(bonusRupees * 100)));
  }

  async getBalance(userId: string) {
    const account = await this.cashAccount(userId);
    return { balancePaise: Number(account.balancePaise), currency: 'INR' as const };
  }

  deposit(userId: string, amountPaise: number, idempotencyKey?: string) {
    return this.move(userId, 'DEPOSIT', amountPaise, idempotencyKey);
  }

  async withdraw(userId: string, amountPaise: number, idempotencyKey?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycStatus: true } });
    if (user.kycStatus !== 'VERIFIED') throw new ForbiddenException('Complete KYC to withdraw money');
    return this.move(userId, 'WITHDRAWAL', amountPaise, idempotencyKey);
  }

  /** Newest first, cursor-paginated: pass the returned nextCursor to get the next page. */
  async transactions(userId: string, limit = 20, cursor?: string) {
    const account = await this.cashAccount(userId);
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { accountId: account.id },
      include: { journal: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((e) => ({
        id: e.id,
        transactionId: e.journalId,
        type: e.journal.type,
        description: e.journal.description,
        amountPaise: Number(e.amountPaise),
        balanceAfterPaise: Number(e.balanceAfterPaise),
        createdAt: e.createdAt,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  private async move(userId: string, type: MoveType, amountPaise: number, idempotencyKey?: string) {
    // A retry with a key we've already processed returns the original result instead of moving money again.
    if (idempotencyKey) {
      const replay = await this.findReplay(userId, idempotencyKey, type, amountPaise);
      if (replay) return replay;
    }

    const amount = BigInt(amountPaise);
    const sign = type === 'DEPOSIT' ? 1n : -1n;
    try {
      const journal = await this.prisma.$transaction(async (tx) => {
        const account = await this.cashAccount(userId, tx);
        return postJournal(tx, {
          userId,
          type,
          description: DESCRIPTIONS[type],
          idempotencyKey,
          postings: [
            { accountId: account.id, amountPaise: sign * amount },
            { accountId: SYSTEM_BANK_ACCOUNT_ID, amountPaise: -sign * amount, allowNegative: true },
          ],
        });
      });
      return this.result(await this.loadJournal(journal.id), false);
    } catch (err) {
      if (err instanceof InsufficientFundsError) throw new UnprocessableEntityException('Insufficient balance');
      // Two requests with the same key raced; the other one won — return its result.
      if (idempotencyKey && isUniqueViolation(err)) {
        const replay = await this.findReplay(userId, idempotencyKey, type, amountPaise);
        if (replay) return replay;
      }
      throw err;
    }
  }

  private async findReplay(userId: string, idempotencyKey: string, type: MoveType, amountPaise: number) {
    const journal = await this.prisma.journalEntry.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: { entries: { include: { account: true } } },
    });
    if (!journal) return null;
    const userEntry = journal.entries.find((e) => e.account.type === 'USER_CASH');
    if (journal.type !== type || !userEntry || abs(userEntry.amountPaise) !== BigInt(amountPaise)) {
      throw new ConflictException('This Idempotency-Key was already used for a different request');
    }
    return this.result(journal, true);
  }

  private loadJournal(id: string) {
    return this.prisma.journalEntry.findUniqueOrThrow({
      where: { id },
      include: { entries: { include: { account: true } } },
    });
  }

  private result(journal: JournalEntry & { entries: (LedgerEntry & { account: { type: string } })[] }, replayed: boolean) {
    const userEntry = journal.entries.find((e) => e.account.type === 'USER_CASH')!;
    return {
      transactionId: journal.id,
      type: journal.type,
      amountPaise: Number(abs(userEntry.amountPaise)),
      balancePaise: Number(userEntry.balanceAfterPaise),
      createdAt: journal.createdAt,
      replayed,
    };
  }

  private async cashAccount(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const account = await tx.ledgerAccount.findFirst({ where: { userId, type: 'USER_CASH' } });
    if (!account) throw new NotFoundException('Wallet not found');
    return account;
  }
}
