import { PrismaClient } from '@prisma/client';
import { EQUITIES, INDICES } from './seed-data/instruments';

const prisma = new PrismaClient();

async function main() {
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

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
