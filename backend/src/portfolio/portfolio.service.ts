import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { csvRupees, toCsv } from '../common/csv';
import { financialYearStart, istDateTime, istDayStart, istRange, isValidDate, todayIst } from '../common/ist-date';
import { roundDiv } from '../common/money';
import { MarketSimulatorService } from '../market/market-simulator.service';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUser } from '../users/user.mapper';

const MAX_RANGE_DAYS = 5 * 366;

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 10_000) / 100 : 0);

/**
 * Read-only views of a user's money and shares: live portfolio valuation,
 * trade book, realised P&L report, cash statement and contract notes, plus CSV exports.
 * All amounts are integer paise (except the CSVs, which use rupees with 2 decimals).
 */
@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulator: MarketSimulatorService,
  ) {}

  // ───────────────────────────── Holdings & summary ─────────────────────────────

  /**
   * Holdings valued at live prices.
   *
   * Day's P&L must not compare shares bought today with yesterday's close, so each
   * holding gets a "day basis": shares held since before today count at the previous
   * close, shares bought today count at what was paid. dayPnl = currentValue − dayBasis.
   * (Clients can recompute dayPnl live as prices tick: qty × ltp − dayBasis.)
   */
  async holdings(userId: string) {
    const todayStart = istDayStart(todayIst());
    const [rows, realizedAll, realizedToday, todayBuys] = await Promise.all([
      this.prisma.holding.findMany({ where: { userId, qty: { gt: 0 } }, orderBy: { symbol: 'asc' } }),
      this.prisma.trade.aggregate({ where: { userId }, _sum: { realizedPnlPaise: true } }),
      this.prisma.trade.aggregate({ where: { userId, createdAt: { gte: todayStart } }, _sum: { realizedPnlPaise: true } }),
      this.prisma.trade.groupBy({
        by: ['symbol'],
        where: { userId, side: 'BUY', createdAt: { gte: todayStart } },
        _sum: { qty: true, valuePaise: true },
      }),
    ]);
    const instruments = await this.prisma.instrument.findMany({
      where: { symbol: { in: rows.map((r) => r.symbol) } },
      select: { symbol: true, name: true, sector: true },
    });

    const holdings = rows.map((h) => {
      const inst = instruments.find((i) => i.symbol === h.symbol);
      const quote = this.simulator.getQuote(h.symbol);
      const invested = Number(h.totalCostPaise);
      const ltp = quote?.ltpPaise ?? Math.round(invested / h.qty);
      const prevClose = quote?.prevClosePaise ?? ltp;

      const bought = todayBuys.find((b) => b.symbol === h.symbol);
      const boughtTodayQty = Math.min(h.qty, bought?._sum.qty ?? 0);
      const boughtTodayCost =
        bought && boughtTodayQty > 0
          ? Number(roundDiv((bought._sum.valuePaise ?? 0n) * BigInt(boughtTodayQty), BigInt(bought._sum.qty!)))
          : 0;
      const dayBasis = (h.qty - boughtTodayQty) * prevClose + boughtTodayCost;

      const current = h.qty * ltp;
      return {
        symbol: h.symbol,
        name: inst?.name ?? h.symbol,
        sector: inst?.sector ?? null,
        qty: h.qty,
        reservedQty: h.reservedQty,
        avgPricePaise: invested / h.qty,
        investedPaise: invested,
        ltpPaise: ltp,
        prevClosePaise: prevClose,
        currentValuePaise: current,
        pnlPaise: current - invested,
        pnlPct: pct(current - invested, invested),
        dayBasisPaise: dayBasis,
        dayPnlPaise: current - dayBasis,
      };
    });

    return {
      holdings,
      realizedPnlPaise: Number(realizedAll._sum.realizedPnlPaise ?? 0n),
      realizedTodayPaise: Number(realizedToday._sum.realizedPnlPaise ?? 0n),
    };
  }

  async summary(userId: string) {
    const [{ holdings, realizedPnlPaise, realizedTodayPaise }, accounts] = await Promise.all([
      this.holdings(userId),
      this.prisma.ledgerAccount.findMany({ where: { userId, type: { in: ['USER_CASH', 'USER_BLOCKED'] } } }),
    ]);
    const cash = Number(accounts.find((a) => a.type === 'USER_CASH')?.balancePaise ?? 0n);
    const blocked = Number(accounts.find((a) => a.type === 'USER_BLOCKED')?.balancePaise ?? 0n);

    const invested = holdings.reduce((s, h) => s + h.investedPaise, 0);
    const current = holdings.reduce((s, h) => s + h.currentValuePaise, 0);
    const dayBasis = holdings.reduce((s, h) => s + h.dayBasisPaise, 0);

    const bySector = new Map<string, number>();
    for (const h of holdings) bySector.set(h.sector ?? 'Other', (bySector.get(h.sector ?? 'Other') ?? 0) + h.currentValuePaise);
    const allocation = [...bySector.entries()]
      .map(([sector, value]) => ({ sector, valuePaise: value, pct: pct(value, current) }))
      .sort((a, b) => b.valuePaise - a.valuePaise);

    return {
      asOf: new Date().toISOString(),
      cashPaise: cash,
      blockedPaise: blocked,
      holdings,
      totals: {
        investedPaise: invested,
        currentValuePaise: current,
        pnlPaise: current - invested,
        pnlPct: pct(current - invested, invested),
        dayPnlPaise: current - dayBasis,
        dayPnlPct: pct(current - dayBasis, dayBasis),
        realizedTodayPaise,
        realizedPnlPaise,
        /** Everything you own: free cash + blocked cash + shares at market value. */
        netWorthPaise: cash + blocked + current,
      },
      allocation,
    };
  }

  // ───────────────────────────── Trade book & P&L ─────────────────────────────

  /** Resolves and validates an optional IST date range (default: this financial year to date). */
  resolveRange(from?: string, to?: string) {
    const today = todayIst();
    const f = from ?? financialYearStart(today);
    const t = to ?? today;
    if (!isValidDate(f)) throw new BadRequestException(`from is not a real date: ${f}`);
    if (!isValidDate(t)) throw new BadRequestException(`to is not a real date: ${t}`);
    if (f > t) throw new BadRequestException('from must be on or before to');
    const { start, end } = istRange(f, t);
    if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      throw new BadRequestException('Date range can be at most 5 years');
    }
    return { from: f, to: t, start, end };
  }

  async trades(userId: string, from?: string, to?: string, symbol?: string, limit = 500) {
    const range = this.resolveRange(from, to);
    const rows = await this.prisma.trade.findMany({
      where: { userId, createdAt: { gte: range.start, lt: range.end }, ...(symbol ? { symbol: symbol.toUpperCase() } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { order: { select: { orderType: true, product: true } } },
    });
    return {
      from: range.from,
      to: range.to,
      trades: rows.map((t) => ({
        id: t.id,
        orderId: t.orderId,
        symbol: t.symbol,
        side: t.side,
        orderType: t.order.orderType,
        product: t.order.product,
        qty: t.qty,
        pricePaise: t.pricePaise,
        valuePaise: Number(t.valuePaise),
        realizedPnlPaise: t.realizedPnlPaise === null ? null : Number(t.realizedPnlPaise),
        createdAt: t.createdAt,
      })),
    };
  }

  /** Realised P&L per stock for sells in the range, plus buy/sell turnover. */
  async pnl(userId: string, from?: string, to?: string) {
    const range = this.resolveRange(from, to);
    const trades = await this.prisma.trade.findMany({
      where: { userId, createdAt: { gte: range.start, lt: range.end } },
      orderBy: { createdAt: 'asc' },
    });
    const names = await this.prisma.instrument.findMany({
      where: { symbol: { in: [...new Set(trades.map((t) => t.symbol))] } },
      select: { symbol: true, name: true },
    });

    const bySymbol = new Map<string, { buyQty: number; buyValue: number; sellQty: number; sellValue: number; realized: number; count: number }>();
    for (const t of trades) {
      const row = bySymbol.get(t.symbol) ?? { buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0, realized: 0, count: 0 };
      if (t.side === 'BUY') {
        row.buyQty += t.qty;
        row.buyValue += Number(t.valuePaise);
      } else {
        row.sellQty += t.qty;
        row.sellValue += Number(t.valuePaise);
        row.realized += Number(t.realizedPnlPaise ?? 0n);
      }
      row.count++;
      bySymbol.set(t.symbol, row);
    }

    const rows = [...bySymbol.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([symbol, r]) => ({
        symbol,
        name: names.find((n) => n.symbol === symbol)?.name ?? symbol,
        trades: r.count,
        buyQty: r.buyQty,
        buyValuePaise: r.buyValue,
        avgBuyPaise: r.buyQty ? r.buyValue / r.buyQty : null,
        sellQty: r.sellQty,
        sellValuePaise: r.sellValue,
        avgSellPaise: r.sellQty ? r.sellValue / r.sellQty : null,
        realizedPnlPaise: r.realized,
      }));

    const sum = (key: 'buyValuePaise' | 'sellValuePaise' | 'realizedPnlPaise' | 'trades') => rows.reduce((s, r) => s + r[key], 0);
    return {
      from: range.from,
      to: range.to,
      rows,
      totals: {
        trades: sum('trades'),
        buyValuePaise: sum('buyValuePaise'),
        sellValuePaise: sum('sellValuePaise'),
        turnoverPaise: sum('buyValuePaise') + sum('sellValuePaise'),
        realizedPnlPaise: sum('realizedPnlPaise'),
        chargesPaise: 0,
      },
    };
  }

  // ───────────────────────────── Statement & contract note ─────────────────────────────

  /** Every movement of the user's cash account in the range, with opening and closing balance. */
  async statement(userId: string, from?: string, to?: string) {
    const range = this.resolveRange(from, to);
    const account = await this.prisma.ledgerAccount.findFirst({ where: { userId, type: 'USER_CASH' } });
    if (!account) throw new NotFoundException('Wallet not found');

    const [before, entries] = await Promise.all([
      this.prisma.ledgerEntry.findFirst({
        where: { accountId: account.id, createdAt: { lt: range.start } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.ledgerEntry.findMany({
        where: { accountId: account.id, createdAt: { gte: range.start, lt: range.end } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { journal: true },
      }),
    ]);
    const opening = Number(before?.balanceAfterPaise ?? 0n);
    const items = entries.map((e) => ({
      id: e.id,
      type: e.journal.type,
      description: e.journal.description,
      amountPaise: Number(e.amountPaise),
      balanceAfterPaise: Number(e.balanceAfterPaise),
      createdAt: e.createdAt,
    }));
    return {
      from: range.from,
      to: range.to,
      openingBalancePaise: opening,
      closingBalancePaise: items.length ? items[items.length - 1].balanceAfterPaise : opening,
      creditsPaise: items.filter((i) => i.amountPaise > 0).reduce((s, i) => s + i.amountPaise, 0),
      debitsPaise: items.filter((i) => i.amountPaise < 0).reduce((s, i) => s - i.amountPaise, 0),
      items,
    };
  }

  /** One day's executed trades, like the contract note a broker sends after market close. */
  async contractNote(userId: string, date: string) {
    if (!isValidDate(date)) throw new BadRequestException(`date is not a real date: ${date}`);
    const { start, end } = istRange(date, date);
    const [user, trades] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.trade.findMany({
        where: { userId, createdAt: { gte: start, lt: end } },
        orderBy: { createdAt: 'asc' },
        include: { order: { select: { orderType: true, product: true } } },
      }),
    ]);
    const buyValue = trades.filter((t) => t.side === 'BUY').reduce((s, t) => s + Number(t.valuePaise), 0);
    const sellValue = trades.filter((t) => t.side === 'SELL').reduce((s, t) => s + Number(t.valuePaise), 0);
    const publicUser = toPublicUser(user);

    return {
      noteNumber: `CN-${date.replace(/-/g, '')}-${userId.slice(0, 8).toUpperCase()}`,
      tradeDate: date,
      client: { name: publicUser.fullName, email: publicUser.email, panMasked: publicUser.panMasked },
      trades: trades.map((t) => ({
        tradeId: t.id,
        orderId: t.orderId,
        time: t.createdAt,
        symbol: t.symbol,
        side: t.side,
        orderType: t.order.orderType,
        product: t.order.product,
        qty: t.qty,
        pricePaise: t.pricePaise,
        valuePaise: Number(t.valuePaise),
      })),
      totals: {
        buyValuePaise: buyValue,
        sellValuePaise: sellValue,
        chargesPaise: 0,
        /** Positive = you receive money, negative = you pay. */
        netPaise: sellValue - buyValue,
      },
    };
  }

  // ───────────────────────────── CSV exports ─────────────────────────────

  async pnlCsv(userId: string, from?: string, to?: string) {
    const r = await this.pnl(userId, from, to);
    const rows = r.rows.map((x) => [
      x.symbol,
      x.name,
      x.trades,
      x.buyQty,
      csvRupees(x.buyValuePaise),
      x.avgBuyPaise === null ? '' : csvRupees(Math.round(x.avgBuyPaise)),
      x.sellQty,
      csvRupees(x.sellValuePaise),
      x.avgSellPaise === null ? '' : csvRupees(Math.round(x.avgSellPaise)),
      csvRupees(x.realizedPnlPaise),
    ]);
    rows.push(['TOTAL', '', r.totals.trades, '', csvRupees(r.totals.buyValuePaise), '', '', csvRupees(r.totals.sellValuePaise), '', csvRupees(r.totals.realizedPnlPaise)]);
    return {
      filename: `sprout-pnl-${r.from}-to-${r.to}.csv`,
      csv: toCsv(
        ['Symbol', 'Name', 'Trades', 'Buy qty', 'Buy value (INR)', 'Avg buy (INR)', 'Sell qty', 'Sell value (INR)', 'Avg sell (INR)', 'Realised P&L (INR)'],
        rows,
      ),
    };
  }

  async tradesCsv(userId: string, from?: string, to?: string, symbol?: string) {
    const r = await this.trades(userId, from, to, symbol, 2000);
    return {
      filename: `sprout-trades-${r.from}-to-${r.to}.csv`,
      csv: toCsv(
        ['Date & time (IST)', 'Symbol', 'Side', 'Order type', 'Product', 'Qty', 'Price (INR)', 'Value (INR)', 'Realised P&L (INR)', 'Trade ID', 'Order ID'],
        [...r.trades].reverse().map((t) => [
          istDateTime(t.createdAt),
          t.symbol,
          t.side,
          t.orderType,
          t.product,
          t.qty,
          csvRupees(t.pricePaise),
          csvRupees(t.valuePaise),
          csvRupees(t.realizedPnlPaise),
          t.id,
          t.orderId,
        ]),
      ),
    };
  }

  async statementCsv(userId: string, from?: string, to?: string) {
    const s = await this.statement(userId, from, to);
    return {
      filename: `sprout-statement-${s.from}-to-${s.to}.csv`,
      csv: toCsv(
        ['Date & time (IST)', 'Type', 'Description', 'Credit (INR)', 'Debit (INR)', 'Balance (INR)'],
        [
          ['', 'OPENING', 'Opening balance', '', '', csvRupees(s.openingBalancePaise)],
          ...s.items.map((i) => [
            istDateTime(i.createdAt),
            i.type,
            i.description,
            i.amountPaise > 0 ? csvRupees(i.amountPaise) : '',
            i.amountPaise < 0 ? csvRupees(-i.amountPaise) : '',
            csvRupees(i.balanceAfterPaise),
          ]),
          ['', 'CLOSING', 'Closing balance', csvRupees(s.creditsPaise), csvRupees(s.debitsPaise), csvRupees(s.closingBalancePaise)],
        ],
      ),
    };
  }
}
