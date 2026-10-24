import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Gtt } from '@prisma/client';
import { inr } from '../common/money';
import { MarketSimulatorService } from '../market/market-simulator.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountGateway } from './account.gateway';
import { CreateGttDto, ListGttQuery } from './gtt.dto';
import { OrdersService } from './orders.service';

export const MAX_ACTIVE_GTTS = 50;
/** A trigger must be at least 0.25% away from the price, or it would fire straight away. */
const MIN_TRIGGER_GAP = 0.0025;
const GTT_LIFETIME_MS = 365 * 86_400_000;

export function toGttView(g: Gtt) {
  return {
    id: g.id,
    symbol: g.symbol,
    side: g.side,
    kind: g.kind,
    qty: g.qty,
    triggerPricePaise: g.triggerPricePaise,
    limitPricePaise: g.limitPricePaise,
    stopTriggerPricePaise: g.stopTriggerPricePaise,
    stopLimitPricePaise: g.stopLimitPricePaise,
    ltpAtCreationPaise: g.ltpAtCreationPaise,
    status: g.status,
    triggeredLeg: g.triggeredLeg,
    orderId: g.orderId,
    statusReason: g.statusReason,
    expiresAt: g.expiresAt,
    triggeredAt: g.triggeredAt,
    createdAt: g.createdAt,
  };
}

/**
 * GTT = Good Till Triggered: a standing instruction that lasts up to a year, across trading days.
 * Nothing is blocked while it waits. When the price reaches a trigger, a normal LIMIT order is
 * placed (with all the usual checks — it can still be rejected for funds or holdings).
 *
 *   SINGLE  one trigger, buy or sell. Fires when the price rises to it (if it was set above the
 *           price) or falls to it (if it was set below).
 *   OCO     "One Cancels Other", sell only: a target above the price and a stop-loss below it.
 *           Whichever is reached first fires; the other leg ends with it.
 */
@Injectable()
export class GttService {
  private readonly logger = new Logger(GttService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulator: MarketSimulatorService,
    private readonly orders: OrdersService,
    private readonly gateway: AccountGateway,
  ) {}

  async create(userId: string, dto: CreateGttDto) {
    const symbol = dto.symbol.toUpperCase();
    const inst = await this.prisma.instrument.findFirst({ where: { symbol, isActive: true } });
    if (!inst) throw new BadRequestException(`Unknown symbol ${symbol}`);
    if (inst.type !== 'EQUITY') throw new BadRequestException('GTT is available for stocks only');
    const ltp = this.simulator.getQuote(symbol)?.ltpPaise;
    if (!ltp) throw new ServiceUnavailableException(`No live price for ${symbol} yet`);
    if (dto.qty % inst.lotSize !== 0) throw new BadRequestException(`Quantity must be a multiple of the lot size (${inst.lotSize})`);

    const onTick = (label: string, paise: number) => {
      if (paise % inst.tickSizePaise !== 0) throw new BadRequestException(`${label} must be a multiple of ${inr(inst.tickSizePaise)}`);
    };
    const awayFromPrice = (label: string, paise: number) => {
      if (Math.abs(paise - ltp) < ltp * MIN_TRIGGER_GAP) {
        throw new BadRequestException(`${label} must be at least 0.25% away from the current price (${inr(ltp)})`);
      }
    };
    onTick('Trigger price', dto.triggerPricePaise);
    onTick('Limit price', dto.limitPricePaise);

    if (dto.kind === 'OCO') {
      if (dto.side !== 'SELL') throw new BadRequestException('An OCO GTT sells shares you hold: side must be SELL');
      if (dto.stopTriggerPricePaise === undefined || dto.stopLimitPricePaise === undefined) {
        throw new BadRequestException('An OCO GTT needs stopTriggerPricePaise and stopLimitPricePaise');
      }
      onTick('Stop-loss trigger price', dto.stopTriggerPricePaise);
      onTick('Stop-loss limit price', dto.stopLimitPricePaise);
      if (dto.triggerPricePaise <= ltp) throw new BadRequestException(`Target trigger must be above the current price (${inr(ltp)})`);
      if (dto.stopTriggerPricePaise >= ltp) throw new BadRequestException(`Stop-loss trigger must be below the current price (${inr(ltp)})`);
      awayFromPrice('Target trigger', dto.triggerPricePaise);
      awayFromPrice('Stop-loss trigger', dto.stopTriggerPricePaise);
    } else {
      if (dto.stopTriggerPricePaise !== undefined || dto.stopLimitPricePaise !== undefined) {
        throw new BadRequestException('Stop-loss prices are only allowed for OCO GTTs');
      }
      awayFromPrice('Trigger price', dto.triggerPricePaise);
    }

    if (dto.side === 'SELL') {
      const holding = await this.prisma.holding.findUnique({ where: { userId_symbol: { userId, symbol } } });
      const held = holding?.qty ?? 0;
      if (held < dto.qty) throw new BadRequestException(held ? `You hold only ${held} shares of ${symbol}` : `You don't hold ${symbol}`);
    }
    const active = await this.prisma.gtt.count({ where: { userId, status: 'ACTIVE' } });
    if (active >= MAX_ACTIVE_GTTS) throw new BadRequestException(`You can have at most ${MAX_ACTIVE_GTTS} active GTTs`);

    const gtt = await this.prisma.gtt.create({
      data: {
        userId,
        symbol,
        side: dto.side,
        kind: dto.kind,
        qty: dto.qty,
        triggerPricePaise: dto.triggerPricePaise,
        limitPricePaise: dto.limitPricePaise,
        stopTriggerPricePaise: dto.stopTriggerPricePaise ?? null,
        stopLimitPricePaise: dto.stopLimitPricePaise ?? null,
        ltpAtCreationPaise: ltp,
        expiresAt: new Date(Date.now() + GTT_LIFETIME_MS),
      },
    });
    this.notify(gtt);
    return toGttView(gtt);
  }

  async list(userId: string, query: ListGttQuery) {
    const rows = await this.prisma.gtt.findMany({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toGttView);
  }

  async cancel(userId: string, id: string) {
    const gtt = await this.prisma.gtt.findFirst({ where: { id, userId } });
    if (!gtt) throw new NotFoundException('GTT not found');
    const { count } = await this.prisma.gtt.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'CANCELLED', statusReason: 'Cancelled by you' },
    });
    if (count === 0) throw new ConflictException(`Only active GTTs can be cancelled (this one is ${gtt.status})`);
    const updated = await this.prisma.gtt.findUniqueOrThrow({ where: { id } });
    this.notify(updated);
    return toGttView(updated);
  }

  /** Called by the matcher on every tick while the market is open. */
  async checkAll() {
    const active = await this.prisma.gtt.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    for (const g of active) {
      if (g.expiresAt <= new Date()) {
        await this.finish(g.id, { status: 'EXPIRED', statusReason: 'Not triggered within a year' });
        continue;
      }
      const ltp = this.simulator.getQuote(g.symbol)?.ltpPaise;
      const leg = ltp === undefined ? null : this.firedLeg(g, ltp);
      if (leg) await this.fire(g, leg.name, leg.limitPaise);
    }
  }

  private firedLeg(g: Gtt, ltp: number) {
    if (g.kind === 'SINGLE') {
      const rising = g.triggerPricePaise > g.ltpAtCreationPaise;
      const hit = rising ? ltp >= g.triggerPricePaise : ltp <= g.triggerPricePaise;
      return hit ? { name: 'SINGLE', limitPaise: g.limitPricePaise } : null;
    }
    if (ltp >= g.triggerPricePaise) return { name: 'TARGET', limitPaise: g.limitPricePaise };
    if (g.stopTriggerPricePaise !== null && ltp <= g.stopTriggerPricePaise) return { name: 'STOPLOSS', limitPaise: g.stopLimitPricePaise! };
    return null;
  }

  private async fire(g: Gtt, leg: string, limitPaise: number) {
    // Claim it first: a GTT fires once, even if two ticks race (or the user cancels at the same moment).
    const { count } = await this.prisma.gtt.updateMany({
      where: { id: g.id, status: 'ACTIVE' },
      data: { status: 'TRIGGERED', triggeredLeg: leg, triggeredAt: new Date() },
    });
    if (count === 0) return;
    try {
      const order = await this.orders.place(
        g.userId,
        { symbol: g.symbol, side: g.side, orderType: 'LIMIT', qty: g.qty, limitPricePaise: limitPaise },
        `gtt-${g.id}`, // the same GTT can never place two orders
      );
      await this.finish(g.id, { orderId: order.id, statusReason: order.status === 'REJECTED' ? `Order rejected: ${order.statusReason}` : null });
    } catch (err) {
      this.logger.warn(`GTT ${g.id} triggered but its order failed: ${(err as Error).message}`);
      await this.finish(g.id, { status: 'FAILED', statusReason: `Order not placed: ${(err as Error).message}` });
    }
  }

  private async finish(id: string, data: Partial<Pick<Gtt, 'status' | 'statusReason' | 'orderId'>>) {
    this.notify(await this.prisma.gtt.update({ where: { id }, data }));
  }

  private notify(g: Gtt) {
    this.gateway.emitToUser(g.userId, 'gtt', toGttView(g));
  }
}
