import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { openUserAccounts } from '../src/wallet/ledger';
import { FUNDAMENTALS } from './seed-data/fundamentals';
import { EQUITIES, INDICES } from './seed-data/instruments';

const prisma = new PrismaClient();

/** A ready-to-use, KYC-verified account for manual testing and Playwright. */
export const DEMO_USER = {
  email: 'demo@sprout.dev',
  password: 'Demo@1234',
  fullName: 'Demo Trader',
  phone: '9876543210',
  pan: 'ABCDE1234F',
  dateOfBirth: '1995-06-15',
};
const DEMO_WELCOME_BONUS_PAISE = 100_000n * 100n; // ₹1,00,000

async function seedInstruments() {
  const all = [...EQUITIES, ...INDICES];
  // Upsert so the seed can be re-run safely (idempotent).
  await prisma.$transaction(
    all.map((i) => {
      const exchange = i.exchange ?? 'NSE';
      const data = {
        name: i.name,
        sector: i.sector,
        type: i.type ?? 'EQUITY',
        refPricePaise: Math.round(i.price * 100),
        peRatio: FUNDAMENTALS[i.symbol]?.pe ?? null,
        marketCapCr: FUNDAMENTALS[i.symbol]?.marketCapCr ?? null,
      } as const;
      return prisma.instrument.upsert({
        where: { exchange_symbol: { exchange, symbol: i.symbol } },
        create: { symbol: i.symbol, exchange, ...data },
        update: data,
      });
    }),
  );
  console.log(`Seeded ${EQUITIES.length} equities and ${INDICES.length} indices.`);
}

async function seedDemoUser() {
  if (await prisma.user.findUnique({ where: { email: DEMO_USER.email } })) {
    console.log(`Demo user ${DEMO_USER.email} already exists.`);
    return;
  }
  const passwordHash = await bcrypt.hash(DEMO_USER.password, 10);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: DEMO_USER.email,
        fullName: DEMO_USER.fullName,
        phone: DEMO_USER.phone,
        passwordHash,
        kycStatus: 'VERIFIED',
        pan: DEMO_USER.pan,
        dateOfBirth: new Date(`${DEMO_USER.dateOfBirth}T00:00:00Z`),
        kycVerifiedAt: new Date(),
      },
    });
    await openUserAccounts(tx, user.id, DEMO_WELCOME_BONUS_PAISE);
  });
  console.log(`Created demo user ${DEMO_USER.email} / ${DEMO_USER.password}`);
}

async function main() {
  await seedInstruments();
  await seedDemoUser();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
