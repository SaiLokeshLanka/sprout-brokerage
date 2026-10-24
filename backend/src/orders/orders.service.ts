import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { computeCharges, Segment } from '../charges/charges';
import { inr, roundDiv } from '../common/money';
import { isUniqueViolation } from '../common/prisma-errors';
import { MarketSimulatorService } from '../market/market-simulator.service';
import {
  isExpired,
  isOptionSymbol,
  listExpiries,
  MAX_STRIKES_FROM_SPOT,
  optionDisplayName,
  parseOptionSymbol,
  UNDERLYINGS,
} from '../options/option-contract';
import { OptionsService } from '../options/options.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  InsufficientFundsError,
  Posting,
  postJournal,
  SYSTEM_CHARGES_ACCOUNT_ID,
  SYSTEM_EXCHANGE_ACCOUNT_ID,
  userAccountIds,
} from '../wallet/ledger';
import { AccountGateway } from './account.gateway';
import { isMarketable, toOrderView } from './order.mapper';
import { ListOrdersQuery, OrderTypeName, PlaceOrderDto } from './orders.dto';

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
  orderType: OrderTypeName;
  product: 'DELIVERY' | 'INTRADAY';
  qty: number;
  limitPricePaise: number | null;
  triggerPricePaise: number | null;
}

const OPEN_STATUSES = ['OPEN', 'TRIGGER_PENDING'] as const;

/**
 * The Order Management System.
 *
 * Every rule is enforced here, on the server: market hours, tick size, circuit band,
 * lot size, funds and holdings. Money moves only through the double-entry ledger:
 *
 *   BUY executes             cash (or blocked) → exchange, then cash → charges
 *   SELL executes            exchange → cash,              then cash → charges
 *   limit / stop BUY waits   cash → blocked: price × qty + charges   (ORDER_BLOCK)
 *   waiting BUY cancelled    blocked → cash                           (ORDER_RELEASE)
 *   limit / stop SELL waits  shares are reserved on the holding (no money moves)
 *
 * Stop-loss orders (SL, SL_M) wait as TRIGGER_PENDING until the price reaches the trigger.
 * Then SL_M executes at the market price and SL becomes an OPEN limit order.
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
    private readonly options: OptionsService,
    private readonly gateway: AccountGateway,
  ) {}

  // ───────────────────────────── Place ─────────────────────────────

  async place(userId: string, dto: PlaceOrderDto, idempotencyKey?: string) {
    const request = this.toRequest(dto);

    // A retry with an already-used key returns the original order instead of placing a second one.
    if (idempotencyKey) {
      const replay = await this.findReplay(userId, idempotencyKey, request);
      if (replay) return replay;
    }

    const { ltpPaise } = await this.validate(request, dto); // input errors → 400, no order is recorded
    const base = { userId, ...request, idempotencyKey };

    // Risk checks below record a REJECTED order, like a real broker's RMS.
    if (!this.simulator.status().open) return this.reject(base, 'Market is closed');

    const stop = request.orderType === 'SL' || request.orderType === 'SL_M';
    const fillNow =
      request.orderType === 'MARKET' || (request.orderType === 'LIMIT' && isMarketable(request.side, request.limitPricePaise!, ltpPaise));

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({ data: { ...base, status: stop ? 'TRIGGER_PENDING' : 'OPEN' } });
        return fillNow ? this.execute(tx, created, ltpPaise, false) : this.rest(tx, created);
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

  /**
   * What an order would cost before placing it: value, every charge, and the total
   * to pay (buy) or receive (sell). Runs the same input checks as placing.
   */
  async preview(userId: string, dto: PlaceOrderDto) {
    const request = this.toRequest(dto);
    const { ltpPaise } = await this.validate(request, dto);
    const price = request.orderType === 'MARKET' ? ltpPaise : (request.limitPricePaise ?? request.triggerPricePaise!);
    const value = BigInt(price) * BigInt(request.qty);
    const charges = computeCharges(this.segmentOf(request), request.side, value);
    const cash = await this.prisma.ledgerAccount.findFirst({ where: { userId, type: 'USER_CASH' } });
    const available = Number(cash?.balancePaise ?? 0n);
    const total = request.side === 'BUY' ? Number(value) + charges.totalPaise : Number(value) - charges.totalPaise;
    return {
      symbol: request.symbol,
      side: request.side,
      orderType: request.orderType,
      qty: request.qty,
      /** The price used: live price for market orders, otherwise the limit (or trigger for SL-M). */
      pricePaise: price,
      ltpPaise,
      valuePaise: Number(value),
      charges,
      /** Buy: value + charges (what you pay). Sell: value − charges (what you receive). */
      totalPaise: total,
      availablePaise: available,
      sufficientFunds: request.side === 'SELL' || available >= total,
    };
  }

  private toRequest(dto: PlaceOrderDto): OrderRequest {
    const usesLimit = dto.orderType === 'LIMIT' || dto.orderType === 'SL';
    const usesTrigger = dto.orderType === 'SL' || dto.orderType === 'SL_M';
    return {
      symbol: dto.symbol.toUpperCase(),
      side: dto.side,
      orderType: dto.orderType,
      product: dto.product ?? 'DELIVERY',
      qty: dto.qty,
      limitPricePaise: usesLimit ? (dto.limitPricePaise ?? null) : null,
      triggerPricePaise: usesTrigger ? (dto.triggerPricePaise ?? null) : null,
    };
  }

  /** Charges depend on the segment: options, intraday equity or delivery equity. */
  private segmentOf(o: { symbol: string; product: 'DELIVERY' | 'INTRADAY' }): Segment {
    if (isOptionSymbol(o.symbol)) return 'OPTIONS';
    return o.product === 'INTRADAY' ? 'EQUITY_INTRADAY' : 'EQUITY_DELIVERY';
  }

  private async validate(request: OrderRequest, dto: PlaceOrderDto) {
    const market = await this.instrumentRules(request);
    if (request.qty % market.lotSize !== 0) {
      throw new BadRequestException(`Quantity must be a multiple of the lot size (${market.lotSize})`);
    }

    const checkPrice = (label: string, paise: number) => {
      if (paise % market.tickPaise !== 0) throw new BadRequestException(`${label} must be a multiple of ${inr(market.tickPaise)}`);
      const { lowerPaise: lower, upperPaise: upper } = market;
      if (lower !== null && upper !== null && (paise < lower || paise > upper)) {
        throw new BadRequestException(`${label} must be within today's price band ${inr(lower)} – ${inr(upper)}`);
      }
    };
    const { orderType, side, limitPricePaise: limit, triggerPricePaise: trigger } = request;
    const ltp = market.ltpPaise;

    if (dto.limitPricePaise !== undefined && limit === null) {
      throw new BadRequestException('limitPricePaise is only allowed for LIMIT and SL orders');
    }
    if (dto.triggerPricePaise !== undefined && trigger === null) {
      throw new BadRequestException('triggerPricePaise is only allowed for SL and SL_M orders');
    }
    if ((orderType === 'LIMIT' || orderType === 'SL') && limit === null) {
      throw new BadRequestException(`limitPricePaise is required for a ${orderType} order`);
    }
    if ((orderType === 'SL' || orderType === 'SL_M') && trigger === null) {
      throw new BadRequestException(`triggerPricePaise is required for a ${orderType} order`);
    }
    if (limit !== null) checkPrice('Limit price', limit);
    if (trigger !== null) {
      checkPrice('Trigger price', trigger);
      // A stop that has already been crossed would fire at once — almost always a typing mistake.
      if (side === 'SELL' && trigger >= ltp) {
        throw new BadRequestException(`Trigger price must be below the current price (${inr(ltp)}) for a stop-loss sell`);
      }
      if (side === 'BUY' && trigger <= ltp) {
        throw new BadRequestException(`Trigger price must be above the current price (${inr(ltp)}) for a stop-loss buy`);
      }
      if (orderType === 'SL' && side === 'SELL' && limit! > trigger) {
        throw new BadRequestException('For a stop-loss sell, the limit price must be at or below the trigger price');
      }
      if (orderType === 'SL' && side === 'BUY' && limit! < trigger) {
        throw new BadRequestException('For a stop-loss buy, the limit price must be at or above the trigger price');
      }
    }
    return market;
  }

  /** Lot size, tick size, price band and live price of a stock or an option contract. */
  private async instrumentRules(request: OrderRequest) {
    const contract = parseOptionSymbol(request.symbol);
    if (contract) {
      const cfg = UNDERLYINGS[contract.underlying];
      if (contract.strikePaise <= 0 || contract.strikePaise % cfg.strikeStepPaise !== 0) {
        throw new BadRequestException(`${contract.underlying} strikes are multiples of ${inr(cfg.strikeStepPaise)}`);
      }
      const quote = this.options.quote(contract);
      if (!quote) throw new ServiceUnavailableException(`No live price for ${contract.underlying} yet`);
      if (quote.expired) throw new BadRequestException(`${optionDisplayName(contract)} has expired`);
      // New positions only in listed contracts near the money; an existing position can always be sold.
      if (request.side === 'BUY') {
        if (!listExpiries(cfg).includes(contract.expiry)) {
          throw new BadRequestException(`${contract.underlying} has no contract expiring on ${contract.expiry}`);
        }
        if (Math.abs(contract.strikePaise - quote.spotPaise) > MAX_STRIKES_FROM_SPOT * cfg.strikeStepPaise) {
          throw new BadRequestException('Strike is too far from the current price');
        }
      }
      return { lotSize: cfg.lotSize, tickPaise: 5, lowerPaise: null, upperPaise: null, ltpPaise: quote.ltpPaise };
    }

    const inst = await this.prisma.instrument.findFirst({ where: { symbol: request.symbol, isActive: true } });
    if (!inst) throw new BadRequestException(`Unknown symbol ${request.symbol}`);
    if (inst.type !== 'EQUITY') throw new BadRequestException('Indices cannot be traded');
    const quote = this.simulator.getQuote(request.symbol);
    if (!quote) throw new ServiceUnavailableException(`No live price for ${request.symbol} yet`);
    return {
      lotSize: inst.lotSize,
      tickPaise: inst.tickSizePaise,
      lowerPaise: quote.lowerCircuitPaise,
      upperPaise: quote.upperCircuitPaise,
      ltpPaise: quote.ltpPaise,
    };
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
      order.limitPricePaise === request.limitPricePaise &&
      order.triggerPricePaise === request.triggerPricePaise;
    if (!same) throw new ConflictException('This Idempotency-Key was already used for a different order');
    return toOrderView(order);
  }

  // ─────────────────────── Execute / wait (inside a transaction) ───────────────────────

  /** Fills an order completely at `pricePaise`. `fromReserved` = sell shares that a waiting order reserved. */
  private async execute(tx: Tx, order: Order, pricePaise: number, fromReserved: boolean): Promise<Order> {
    const value = BigInt(pricePaise) * BigInt(order.qty);
    const charges = computeCharges(this.segmentOf(order), order.side, value);
    const chargesTotal = BigInt(charges.totalPaise);
    const accounts = await userAccountIds(tx, order.userId);
    const what = `${order.qty} × ${order.symbol} @ ${inr(pricePaise)}`;
    let realized: bigint | null = null;

    if (order.side === 'BUY') {
      const postings: Posting[] = [{ accountId: SYSTEM_EXCHANGE_ACCOUNT_ID, amountPaise: value, allowNegative: true }];
      if (order.blockedPaise > 0n) {
        // Pay from the blocked money; what's left (normally at least the charges) goes back to cash.
        // It is negative only when an SL-M buy fills above its trigger: the difference comes from cash.
        const remainder = order.blockedPaise - value;
        postings.push({ accountId: accounts.blocked, amountPaise: -order.blockedPaise });
        if (remainder !== 0n) postings.push({ accountId: accounts.cash, amountPaise: remainder });
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

    if (chargesTotal > 0n) {
      await postJournal(tx, {
        userId: order.userId,
        type: 'CHARGES',
        description: `Charges on ${order.side === 'BUY' ? 'buy' : 'sell'} ${what}`,
        postings: [
          { accountId: accounts.cash, amountPaise: -chargesTotal }, // throws InsufficientFundsError
          { accountId: SYSTEM_CHARGES_ACCOUNT_ID, amountPaise: chargesTotal },
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
        chargesPaise: chargesTotal,
        charges: { ...charges },
      },
    });
    return tx.order.update({
      where: { id: order.id },
      data: { status: 'EXECUTED', fillPricePaise: pricePaise, blockedPaise: 0, chargesPaise: chargesTotal, executedAt: new Date() },
    });
  }

  /**
   * An order that can't fill yet: block the money (buy) or reserve the shares (sell).
   * A buy blocks price × qty plus the charges at that price. It fills at that price or better,
   * so the blocked amount covers the trade and its charges.
   */
  private async rest(tx: Tx, order: Order): Promise<Order> {
    if (order.side === 'BUY') {
      const price = order.limitPricePaise ?? order.triggerPricePaise!;
      const value = BigInt(price) * BigInt(order.qty);
      const amount = value + BigInt(computeCharges(this.segmentOf(order), 'BUY', value).totalPaise);
      const accounts = await userAccountIds(tx, order.userId);
      await postJournal(tx, {
        userId: order.userId,
        type: 'ORDER_BLOCK',
        description: `Blocked for buy order: ${order.qty} × ${order.symbol} @ ${inr(price)} (incl. charges)`,
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

  private sellableMessage(symbol: string, h: LockedHolding | null, free: number) {
    const unit = isOptionSymbol(symbol) ? 'units' : 'shares';
    if (!h || h.qty === 0) return isOptionSymbol(symbol) ? "You don't hold this option" : "You don't hold this stock";
    if (free === 0) return `All your ${unit} are already in open sell orders`;
    return `You can sell at most ${free} ${unit}`;
  }

  private async reserveShares(tx: Tx, userId: string, symbol: string, qty: number) {
    const h = await this.lockHolding(tx, userId, symbol);
    const free = h ? h.qty - h.reservedQty : 0;
    if (!h || qty > free) throw new InsufficientHoldingsError(this.sellableMessage(symbol, h, free));
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
    if (!h || qty > sellable || qty > h.qty) throw new InsufficientHoldingsError(this.sellableMessage(symbol, h, free));

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

  // ─────────────────────── Fill, trigger, cancel, expire ───────────────────────

  /** Called by the matcher when an OPEN limit order's price is reached. */
  async fillOpenOrder(orderId: string, pricePaise: number) {
    try {
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
    } catch (err) {
      if (err instanceof InsufficientFundsError) return this.close(orderId, 'REJECTED', 'Insufficient funds for charges when the order executed');
      throw err;
    }
  }

  /**
   * Called by the matcher when a TRIGGER_PENDING order's trigger price is reached.
   * SL-M executes at the market price. SL becomes an OPEN limit order (and fills at once if it can).
   */
  async triggerOrder(orderId: string, ltpPaise: number) {
    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({ where: { id: orderId } });
        if (!current || current.status !== 'TRIGGER_PENDING') return null;
        const fillNow = current.orderType === 'SL_M' || isMarketable(current.side, current.limitPricePaise!, ltpPaise);
        const { count } = await tx.order.updateMany({
          where: { id: orderId, status: 'TRIGGER_PENDING' },
          data: { status: fillNow ? 'EXECUTED' : 'OPEN' },
        });
        if (count === 0) return null;
        // Money was blocked / shares reserved when the order was placed.
        return fillNow ? this.execute(tx, current, ltpPaise, current.side === 'SELL') : tx.order.findUniqueOrThrow({ where: { id: orderId } });
      });
      if (order) this.notify(order);
      return order;
    } catch (err) {
      // An SL-M buy can fill above its trigger, beyond the money blocked for it.
      if (err instanceof InsufficientFundsError) return this.close(orderId, 'REJECTED', 'Insufficient funds when the stop-loss triggered');
      throw err;
    }
  }

  cancel(userId: string, orderId: string) {
    return this.close(orderId, 'CANCELLED', 'Cancelled by you', userId);
  }

  /** Day orders don't carry over: at market close / day end every waiting order expires. */
  async expireOpenOrders(reason: string) {
    const open = await this.prisma.order.findMany({ where: { status: { in: [...OPEN_STATUSES] } }, select: { id: true } });
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

  private async close(orderId: string, status: 'CANCELLED' | 'EXPIRED' | 'REJECTED', reason: string, userId?: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const current = await tx.order.findFirst({ where: { id: orderId, ...(userId ? { userId } : {}) } });
      if (!current) throw new NotFoundException('Order not found');
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: { in: [...OPEN_STATUSES] } },
        data: { status, statusReason: reason, blockedPaise: 0 },
      });
      if (count === 0) throw new ConflictException(`Only open orders can be cancelled (this one is ${current.status})`);

      if (current.side === 'BUY' && current.blockedPaise > 0n) {
        const accounts = await userAccountIds(tx, current.userId);
        const verb = { CANCELLED: 'cancelled', EXPIRED: 'expired', REJECTED: 'rejected' }[status];
        await postJournal(tx, {
          userId: current.userId,
          type: 'ORDER_RELEASE',
          description: `Released: ${verb} buy order ${current.qty} × ${current.symbol}`,
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

  // ───────────────────────────── Option expiry ─────────────────────────────

  /**
   * Index options are cash-settled: at expiry every position is closed at its intrinsic value
   * (what it is worth at the index's price), and waiting orders on the contract expire.
   * `onlyExpiry` settles that expiry date now, even before 3:30 PM (test hook).
   * No charges are taken on settlement in this simulator.
   */
  async settleExpiredOptions(onlyExpiry?: string) {
    const due = (symbol: string) => {
      const c = parseOptionSymbol(symbol);
      return c && (onlyExpiry ? c.expiry === onlyExpiry : isExpired(c)) ? c : null;
    };
    const onOptions = { OR: Object.keys(UNDERLYINGS).map((u) => ({ symbol: { startsWith: u } })) };

    const waiting = await this.prisma.order.findMany({ where: { status: { in: [...OPEN_STATUSES] }, ...onOptions }, select: { id: true, symbol: true } });
    for (const o of waiting.filter((w) => due(w.symbol))) {
      await this.close(o.id, 'EXPIRED', 'Contract expired').catch(() => undefined);
    }

    const positions = await this.prisma.holding.findMany({ where: { qty: { gt: 0 }, ...onOptions } });
    let settled = 0;
    for (const p of positions) {
      const contract = due(p.symbol);
      if (!contract) continue;
      const price = this.options.intrinsicPaise(contract);
      const spot = this.simulator.getQuote(contract.underlying)!.ltpPaise;
      const order = await this.prisma.$transaction(async (tx) => {
        const h = await this.lockHolding(tx, p.userId, p.symbol);
        if (!h || h.qty === 0) return null;
        const value = BigInt(price) * BigInt(h.qty);
        const cost = await this.removeShares(tx, p.userId, p.symbol, h.qty, false);
        const created = await tx.order.create({
          data: {
            userId: p.userId,
            symbol: p.symbol,
            side: 'SELL',
            orderType: 'MARKET',
            qty: h.qty,
            status: 'EXECUTED',
            fillPricePaise: price,
            statusReason: `Settled at expiry (${contract.underlying} at ${inr(spot)})`,
            executedAt: new Date(),
          },
        });
        if (value > 0n) {
          const accounts = await userAccountIds(tx, p.userId);
          await postJournal(tx, {
            userId: p.userId,
            type: 'TRADE_SELL',
            description: `Expiry settlement: ${h.qty} × ${optionDisplayName(contract)} @ ${inr(price)}`,
            postings: [
              { accountId: SYSTEM_EXCHANGE_ACCOUNT_ID, amountPaise: -value, allowNegative: true },
              { accountId: accounts.cash, amountPaise: value },
            ],
          });
        }
        await tx.trade.create({
          data: { orderId: created.id, userId: p.userId, symbol: p.symbol, side: 'SELL', qty: h.qty, pricePaise: price, valuePaise: value, realizedPnlPaise: value - cost },
        });
        return created;
      });
      if (order) {
        this.notify(order);
        settled++;
      }
    }
    if (settled) this.logger.log(`Settled ${settled} expired option position(s)`);
    return settled;
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

  private notify(order: Order) {
    this.gateway.emitToUser(order.userId, 'order', toOrderView(order));
  }
}
