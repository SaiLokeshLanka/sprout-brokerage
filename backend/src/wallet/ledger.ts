import { JournalType, Prisma } from '@prisma/client';

/**
 * Double-entry ledger core. Shared by the WalletService and the seed script.
 *
 * Every money movement is ONE JournalEntry with TWO OR MORE LedgerEntries whose
 * amounts sum to zero: money never appears or disappears, it only moves between
 * accounts. Entries are append-only; balances are a cached running total.
 */

/** The single "outside world" account. Created by a migration, so it always exists. */
export const SYSTEM_BANK_ACCOUNT_ID = 'system-bank';

export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient balance');
  }
}

export interface Posting {
  accountId: string;
  /** Positive = money into the account, negative = money out. */
  amountPaise: bigint;
  /** Only system accounts may go below zero. User accounts never can. */
  allowNegative?: boolean;
}

export interface JournalInput {
  userId: string;
  type: JournalType;
  description: string;
  idempotencyKey?: string;
  postings: Posting[];
}

/**
 * Writes one balanced journal entry. MUST be called inside a transaction so the
 * journal and all its postings commit or roll back together.
 *
 * - Rejects journals whose postings don't sum to zero.
 * - Updates accounts in a stable order (by id), so two concurrent journals lock
 *   rows in the same sequence and cannot deadlock each other.
 * - A debit to a user account is a single conditional UPDATE
 *   (`... WHERE balance >= amount`), so two simultaneous withdrawals can never
 *   overdraw it: the second one simply finds the balance too low.
 */
export async function postJournal(tx: Prisma.TransactionClient, input: JournalInput) {
  const total = input.postings.reduce((sum, p) => sum + p.amountPaise, 0n);
  if (total !== 0n) throw new Error(`Unbalanced journal: postings sum to ${total} paise`);
  if (input.postings.some((p) => p.amountPaise === 0n)) throw new Error('Journal contains a zero-amount posting');

  const journal = await tx.journalEntry.create({
    data: {
      userId: input.userId,
      type: input.type,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
    },
  });

  const ordered = [...input.postings].sort((a, b) => a.accountId.localeCompare(b.accountId));
  for (const p of ordered) {
    if (p.amountPaise < 0n && !p.allowNegative) {
      const { count } = await tx.ledgerAccount.updateMany({
        where: { id: p.accountId, balancePaise: { gte: -p.amountPaise } },
        data: { balancePaise: { increment: p.amountPaise } },
      });
      if (count === 0) throw new InsufficientFundsError();
    } else {
      await tx.ledgerAccount.update({
        where: { id: p.accountId },
        data: { balancePaise: { increment: p.amountPaise } },
      });
    }

    const { balancePaise } = await tx.ledgerAccount.findUniqueOrThrow({
      where: { id: p.accountId },
      select: { balancePaise: true },
    });
    await tx.ledgerEntry.create({
      data: { journalId: journal.id, accountId: p.accountId, amountPaise: p.amountPaise, balanceAfterPaise: balancePaise },
    });
  }

  return journal;
}

/** Opens a user's cash account and credits the welcome bonus (if any) from the system bank. */
export async function openUserCashAccount(tx: Prisma.TransactionClient, userId: string, welcomeBonusPaise: bigint) {
  const account = await tx.ledgerAccount.create({ data: { type: 'USER_CASH', userId } });
  if (welcomeBonusPaise > 0n) {
    await postJournal(tx, {
      userId,
      type: 'WELCOME_BONUS',
      description: 'Welcome bonus (virtual money)',
      postings: [
        { accountId: SYSTEM_BANK_ACCOUNT_ID, amountPaise: -welcomeBonusPaise, allowNegative: true },
        { accountId: account.id, amountPaise: welcomeBonusPaise },
      ],
    });
  }
  return account;
}
