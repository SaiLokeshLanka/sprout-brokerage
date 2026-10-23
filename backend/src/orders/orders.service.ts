import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { inr, roundDiv } from '../common/money';
import { isUniqueViolation } from '../common/prisma-errors';
import { MarketSimulatorService } from '../market/market-simulator.service';
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientFundsError, Posting, postJournal, SYSTEM_EXCHANGE_ACCOUNT_ID, userAccountIds } from '../wallet/ledger';
import { AccountGateway } from './account.gateway';
import { isMarketable, toOrderView } from './order.mapper';
import { ListOrdersQuery, PlaceOrderDto } from './orders.dto';

type Tx = Prisma.TransactionClient;

class InsufficientHoldingsError extends Error {}

interface LockedHolding {
  id: string;
  qty: number;
  reservedQty: number;
  totalCostPaise: bigint;
}

interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  product: 'DELIVERY' | 'INTRADAY';
  qty: number;
  limitPricePaise: number | null;
}

/**
 * The Order Management System.
 *
 * Every rule is enforced here, on the server: market hours, tick size, circuit band,
 * lot size, funds and holdings. Money moves only through the double-entry ledger:
 *
 *   market BUY executes      cash     → exchange
 *   limit BUY waits          cash     → blocked            (ORDER_BLOCK)
 *   limit BUY executes       blocked  → exchange (+ any unused part back to cash)
 *   open BUY cancelled       blocked  → cash               (ORDER_RELEASE)
 *   SELL executes            exchange → cash
 *   limit SELL waits         shares are reserved on the holding (no money moves)
 *
 * Each step runs in one database transaction, so an order and its money/shares
 * always change together or not at all.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulator: MarketSimulatorService,
    private readonly gateway: AccountGateway,
  ) {}

  // ───────────────────────────── Place ─────────────────────────────

  async place(userId: string, dto: PlaceOrderDto, idempotencyKey?: string) {
    const request: OrderRequest = {
      symbol: dto.symbol.toUpperCase(),
      side: dto.side,
      orderType: dto.orderType,
      product: dto.product ?? 'DELIVERY',
      qty: dto.qty,
      limitPricePaise: dto.orderType === 'LIMIT' ? (dto.limitPricePaise ?? null) : null,
    };

    // A retry with an already-used key returns the original order instead of placing a second one.
    if (idempotencyKey) {
      const replay = await this.findReplay(userId, idempotencyKey, request);
      if (replay) return replay;
    }

    await this.validate(request, dto); // input errors → 400, no order is recorded
    const base = { userId, ...request, idempotencyKey };

    // Risk checks below record a REJECTED order, like a real broker's RMS.
    if (!this.simulator.status().open) return this.reject(base, 'Market is closed');

    const ltp = this.simulator.getQuote(request.symbol)!.ltpPaise;
    const fillNow = request.orderType === 'MARKET' || isMarketable(request.side, request.limitPricePaise!, ltp);

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({ data: { ...base, status: 'OPEN' } });
        return fillNow ? this.execute(tx, created, ltp, false) : this.rest(tx, created);
      });
      this.notify(order);
      return toOrderView(order);
    } catch (err) {
      if (err instanceof InsufficientFundsError) return this.reject(base, 'Insufficient funds');
      if (err instanceof InsufficientHoldingsError) return this.reject(base, err.message);
      if (idempotencyKey && isUniqueViolation(err)) {
        const replay = await this.findReplay(userId, idempotencyKey, request);
        if (replay) return replay;
      }
      throw err;
    }
  }

  private async validate(request: OrderRequest, dto: PlaceOrderDto) {
    const inst = await this.prisma.instrument.findFirst({ where: { symbol: request.symbol, isActive: true } });
    if (!inst) throw new BadRequestException(`Unknown symbol ${request.symbol}`);
    if (inst.type !== 'EQUITY') throw new BadRequestException('Indices cannot be traded');
    if (request.qty % inst.lotSize !== 0) {
      throw new BadRequestException(`Quantity must be a multiple of the lot size (${inst.lotSize})`);
    }

    const quote = this.simulator.getQuote(request.symbol);
    if (!quote) throw new ServiceUnavailableException(`No live price for ${request.symbol} yet`);

    if (request.orderType === 'LIMIT') {
      const limit = request.limitPricePaise;
      if (limit === null) throw new BadRequestException('limitPricePaise is required for a LIMIT order');
      if (limit % inst.tickSizePaise !== 0) {
        throw new BadRequestException(`Limit price must be a multiple of ${inr(inst.tickSizePaise)}`);
      }
      const { lowerCircuitPaise: lower, upperCircuitPaise: upper } = quote;
      if (lower !== null && upper !== null && (limit < lower || limit > upper)) {
        throw new BadRequestException(`Limit price must be within today's price band ${inr(lower)} – ${inr(upper)}`);
      }
    } else if (dto.limitPricePaise !== undefined) {
      throw new BadRequestException('limitPricePaise is only allowed for LIMIT orders');
    }
  }

  private async reject(base: OrderRequest & { userId: string; idempotencyKey?: string }, reason: string) {
    try {
      const order = await this.prisma.order.create({ data: { ...base, status: 'REJECTED', statusReason: reason } });
      this.notify(order);
      return toOrderView(order);
    } catch (err) {
      if (base.idempotencyKey && isUniqueViolation(err)) {
        const replay = await this.findReplay(base.userId, base.idempotencyKey, base);
        if (replay) return replay;
      }
      throw err;
    }
  }

  private async findReplay(userId: string, idempotencyKey: string, request: OrderRequest) {
    const order = await this.prisma.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (!order) return null;
    const same =
      order.symbol === request.symbol &&
      order.side === request.side &&
      order.orderType === request.orderType &&
      order.qty === request.qty &&
      order.limitPricePaise === request.limitPricePaise;
    if (!same) throw new ConflictException('This Idempotency-Key was already used for a different order');
    return toOrderView(order);
  }

  // ─────────────────────── Execute / wait (inside a transaction) ───────────────────────

  /** Fills an order completely at `pricePaise`. `fromReserved` = sell shares that an open order reserved. */
  private async execute(tx: Tx, order: Order, pricePaise: number, fromReserved: boolean): Promise<Order> {
    const value = BigInt(pricePaise) * BigInt(order.qty);
    const accounts = await userAccountIds(tx, order.userId);
    const what = `${order.qty} × ${order.symbol} @ ${inr(pricePaise)}`;
    let realized: bigint | null = null;

    if (order.side === 'BUY') {
      const postings: Posting[] = [{ accountId: SYSTEM_EXCHANGE_ACCOUNT_ID, amountPaise: value, allowNegative: true }];
      if (order.blockedPaise > 0n) {
        // Pay from the money blocked at the limit price; any difference goes back to cash.
        const refund = order.blockedPaise - value;
        if (refund < 0n) throw new Error(`Order ${order.id} filled above its limit`);
        postings.push({ accountId: accounts.blocked, amountPaise: -order.blockedPaise });
        if (refund > 0n) postings.push({ accountId: accounts.cash, amountPaise: refund });
      } else {
        postings.push({ accountId: accounts.cash, amountPaise: -value }); // throws InsufficientFundsError
      }
      await postJournal(tx, { userId: order.userId, type: 'TRADE_BUY', description: `Bought ${what}`, postings });
      await this.addShares(tx, order.userId, order.symbol, order.qty, value);
    } else {
      const costOfSharesSold = await this.removeShares(tx, order.userId, order.symbol, order.qty, fromReserved);
      realized = value - costOfSharesSold;
      await postJournal(tx, {
        userId: order.userId,
        type: 'TRADE_SELL',
        description: `Sold ${what}`,
        postings: [
          { accountId: SYSTEM_EXCHANGE_ACCOUNT_ID, amountPaise: -value, allowNegative: true },
          { accountId: accounts.cash, amountPaise: value },
        ],
      });
    }

    await tx.trade.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        pricePaise,
        valuePaise: value,
        realizedPnlPaise: realized,
      },
    });
    return tx.order.update({
      where: { id: order.id },
      data: { status: 'EXECUTED', fillPricePaise: pricePaise, blockedPaise: 0, executedAt: new Date() },
    });
  }

  /** A limit order that can't fill yet: block the money (buy) or reserve the shares (sell). */
  private async rest(tx: Tx, order: Order): Promise<Order> {
    if (order.side === 'BUY') {
      const amount = BigInt(order.limitPricePaise!) * BigInt(order.qty);
      const accounts = await userAccountIds(tx, order.userId);
      await postJournal(tx, {
        userId: order.userId,
        type: 'ORDER_BLOCK',
        description: `Blocked for buy order: ${order.qty} × ${order.symbol} @ ${inr(order.limitPricePaise!)}`,
        postings: [
          { accountId: accounts.cash, amountPaise: -amount }, // throws InsufficientFundsError
          { accountId: accounts.blocked, amountPaise: amount },
        ],
      });
      return tx.order.update({ where: { id: order.id }, data: { blockedPaise: amount } });
    }
    await this.reserveShares(tx, order.userId, order.symbol, order.qty);
    return order;
  }

  // ───────────────────────────── Holdings ─────────────────────────────

  /** Locks the holding row until the transaction ends, so two orders can't use the same shares. */
  private async lockHolding(tx: Tx, userId: string, symbol: string): Promise<LockedHolding | null> {
    const rows = await tx.$queryRaw<LockedHolding[]>`
      SELECT "id", "qty", "reservedQty", "totalCostPaise" FROM "holdings"
      WHERE "userId" = ${userId} AND "symbol" = ${symbol}
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  private async addShares(tx: Tx, userId: string, symbol: string, qty: number, cost: bigint) {
    // Create the row if it doesn't exist; ON CONFLICT makes two simultaneous first buys safe.
    await tx.$executeRaw`
      INSERT INTO "holdings" ("id", "userId", "symbol", "qty", "reservedQty", "totalCostPaise", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${userId}, ${symbol}, 0, 0, 0, NOW(), NOW())
      ON CONFLICT ("userId", "symbol") DO NOTHING`;
    const h = (await this.lockHolding(tx, userId, symbol))!;
    await tx.holding.update({ where: { id: h.id }, data: { qty: h.qty + qty, totalCostPaise: h.totalCostPaise + cost } });
  }

  private sellableMessage(h: LockedHolding | null, free: number) {
    if (!h || h.qty === 0) return "You don't hold this stock";
    if (free === 0) return 'All your shares are already in open sell orders';
    return `You can sell at most ${free} shares`;
  }

  private async reserveShares(tx: Tx, userId: string, symbol: string, qty: number) {
    const h = await this.lockHolding(tx, userId, symbol);
    const free = h ? h.qty - h.reservedQty : 0;
    if (!h || qty > free) throw new InsufficientHoldingsError(this.sellableMessage(h, free));
    await tx.holding.update({ where: { id: h.id }, data: { reservedQty: h.reservedQty + qty } });
  }

  private async releaseShares(tx: Tx, userId: string, symbol: string, qty: number) {
    const h = await this.lockHolding(tx, userId, symbol);
    if (h) await tx.holding.update({ where: { id: h.id }, data: { reservedQty: Math.max(0, h.reservedQty - qty) } });
  }

  /** Removes sold shares and returns their cost (average-cost method). */
  private async removeShares(tx: Tx, userId: string, symbol: string, qty: number, fromReserved: boolean) {
    const h = await this.lockHolding(tx, userId, symbol);
    const free = h ? h.qty - h.reservedQty : 0;
    const sellable = h ? (fromReserved ? h.reservedQty : free) : 0;
    if (!h || qty > sellable || qty > h.qty) throw new InsufficientHoldingsError(this.sellableMessage(h, free));

    const cost = qty === h.qty ? h.totalCostPaise : roundDiv(h.totalCostPaise * BigInt(qty), BigInt(h.qty));
    await tx.holding.update({
      where: { id: h.id },
      data: {
        qty: h.qty - qty,
        reservedQty: fromReserved ? h.reservedQty - qty : h.reservedQty,
        totalCostPaise: h.totalCostPaise - cost,
      },
    });
    return cost;
  }

  // ─────────────────────── Fill, cancel, expire ───────────────────────

  /** Called by the matcher when an OPEN limit order's price is reached. */
  async fillOpenOrder(orderId: string, pricePaise: number) {
    const order = await this.prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id: orderId } });
      if (!current || current.status !== 'OPEN') return null;
      // Claim the order. If a cancel got there first, nothing is updated and we stop.
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: 'OPEN' }, data: { status: 'EXECUTED' } });
      if (count === 0) return null;
      return this.execute(tx, current, pricePaise, current.side === 'SELL');
    });
    if (order) this.notify(order);
    return order;
  }

  cancel(userId: string, orderId: string) {
    return this.close(orderId, 'CANCELLED', 'Cancelled by you', userId);
  }

  /** Day orders don't carry over: at market close / day end every open order expires. */
  async expireOpenOrders(reason: string) {
    const open = await this.prisma.order.findMany({ where: { status: 'OPEN' }, select: { id: true } });
    let expired = 0;
    for (const { id } of open) {
      try {
        await this.close(id, 'EXPIRED', reason);
        expired++;
      } catch (err) {
        if (!(err instanceof ConflictException)) this.logger.error(`Could not expire order ${id}: ${(err as Error).message}`);
      }
    }
    if (expired) this.logger.log(`Expired ${expired} open order(s): ${reason}`);
    return expired;
  }

  private async close(orderId: string, status: 'CANCELLED' | 'EXPIRED', reason: string, userId?: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const current = await tx.order.findFirst({ where: { id: orderId, ...(userId ? { userId } : {}) } });
      if (!current) throw new NotFoundException('Order not found');
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'OPEN' },
        data: { status, statusReason: reason, blockedPaise: 0 },
      });
      if (count === 0) throw new ConflictException(`Only open orders can be cancelled (this one is ${current.status})`);

      if (current.side === 'BUY' && current.blockedPaise > 0n) {
        const accounts = await userAccountIds(tx, current.userId);
        await postJournal(tx, {
          userId: current.userId,
          type: 'ORDER_RELEASE',
          description: `Released: ${status === 'EXPIRED' ? 'expired' : 'cancelled'} buy order ${current.qty} × ${current.symbol}`,
          postings: [
            { accountId: accounts.blocked, amountPaise: -current.blockedPaise },
            { accountId: accounts.cash, amountPaise: current.blockedPaise },
          ],
        });
      } else if (current.side === 'SELL') {
        await this.releaseShares(tx, current.userId, current.symbol, current.qty);
      }
      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
    this.notify(order);
    return toOrderView(order);
  }

  // ───────────────────────────── Queries ─────────────────────────────

  async list(userId: string, query: ListOrdersQuery) {
    const orders = await this.prisma.order.findMany({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
    });
    return orders.map(toOrderView);
  }

  async get(userId: string, orderId: string) {
    // Filtering by userId means another user's order looks exactly like a missing one (404).
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new NotFoundException('Order not found');
    return toOrderView(order);
  }

  async holdings(userId: string) {
    const [rows, realized] = await Promise.all([
      this.prisma.holding.findMany({ where: { userId, qty: { gt: 0 } }, orderBy: { symbol: 'asc' } }),
      this.prisma.trade.aggregate({ where: { userId }, _sum: { realizedPnlPaise: true } }),
    ]);
    return {
      holdings: rows.map((h) => ({
        symbol: h.symbol,
        qty: h.qty,
        reservedQty: h.reservedQty,
        investedPaise: Number(h.totalCostPaise),
        avgPricePaise: Number(h.totalCostPaise) / h.qty,
      })),
      realizedPnlPaise: Number(realized._sum.realizedPnlPaise ?? 0n),
    };
  }

  private notify(order: Order) {
    this.gateway.emitToUser(order.userId, 'order', toOrderView(order));
  }
}
