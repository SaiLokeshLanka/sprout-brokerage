import { Injectable, NotFoundException } from '@nestjs/common';
import { InstrumentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InstrumentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(filter: { type?: InstrumentType; q?: string }) {
    const where: Prisma.InstrumentWhereInput = { isActive: true };
    if (filter.type) where.type = filter.type;
    if (filter.q) {
      where.OR = [
        { symbol: { contains: filter.q, mode: 'insensitive' } },
        { name: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.instrument.findMany({ where, orderBy: [{ type: 'desc' }, { symbol: 'asc' }] });
  }

  async getBySymbol(symbol: string) {
    const instrument = await this.prisma.instrument.findFirst({
      where: { symbol: symbol.toUpperCase(), isActive: true },
    });
    if (!instrument) throw new NotFoundException(`Instrument ${symbol} not found`);
    return instrument;
  }
}
