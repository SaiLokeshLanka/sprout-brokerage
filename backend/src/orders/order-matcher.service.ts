import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MarketSimulatorService } from '../market/market-simulator.service';
import { isExpired, parseOptionSymbol } from '../options/option-contract';
import { OptionsService } from '../options/options.service';
import { PrismaService } from '../prisma/prisma.service';
import { GttService } from './gtt.service';
import { isMarketable, isTriggered } from './order.mapper';
import { OrdersService } from './orders.service';

const SETTLEMENT_CHECK_MS = 30_000;

/**
 * Runs after every price tick, whether or not the user's browser is open:
 * - fills OPEN limit orders whose price has been reached, oldest first, at the current price
 * - activates TRIGGER_PENDING stop-loss orders whose trigger has been reached
 * - fires GTTs whose trigger has been reached
 * Also expires waiting orders when the market closes or a new trading day starts,
 * and every 30 seconds settles option positions that have reached expiry.
 */
@Injectable()
export class OrderMatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderMatcherService.name);
  private running = false;
  private runAgain = false;
  private settleTimer?: NodeJS.Timeout;

  private readonly onTick = () => void this.run();
  private readonly onClose = () => void this.expire('Expired — market closed');
  private readonly onRollover = () => void this.expire('Expired at end of day');

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulator: MarketSimulatorService,
    private readonly options: OptionsService,
    private readonly orders: OrdersService,
    private readonly gtt: GttService,
  ) {}

  onModuleInit() {
    this.simulator.events.on('tick', this.onTick);
    this.simulator.events.on('session-closed', this.onClose);
    this.simulator.events.on('rollover', this.onRollover);
    this.settleTimer = setInterval(() => void this.settle(), SETTLEMENT_CHECK_MS);
  }

  onModuleDestroy() {
    this.simulator.events.off('tick', this.onTick);
    this.simulator.events.off('session-closed', this.onClose);
    this.simulator.events.off('rollover', this.onRollover);
    clearInterval(this.settleTimer);
  }

  /** Never runs twice at once; a tick that arrives mid-run triggers one more pass. */
  async run() {
    if (this.running) {
      this.runAgain = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.runAgain = false;
        if (!this.simulator.status().open) return;
        const waiting = await this.prisma.order.findMany({
          where: { status: { in: ['OPEN', 'TRIGGER_PENDING'] } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, symbol: true, side: true, status: true, limitPricePaise: true, triggerPricePaise: true },
        });
        for (const o of waiting) {
          const contract = parseOptionSymbol(o.symbol);
          if (contract && isExpired(contract)) continue; // settlement expires it
          const ltp = this.options.priceOf(o.symbol)?.ltpPaise;
          if (ltp === undefined) continue;
          const fail = (err: Error) => this.logger.error(`Could not process order ${o.id}: ${err.message}`);
          if (o.status === 'OPEN' && o.limitPricePaise !== null && isMarketable(o.side, o.limitPricePaise, ltp)) {
            await this.orders.fillOpenOrder(o.id, ltp).catch(fail);
          } else if (o.status === 'TRIGGER_PENDING' && o.triggerPricePaise !== null && isTriggered(o.side, o.triggerPricePaise, ltp)) {
            await this.orders.triggerOrder(o.id, ltp).catch(fail);
          }
        }
        await this.gtt.checkAll();
      } while (this.runAgain);
    } catch (err) {
      this.logger.warn(`Matching pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async expire(reason: string) {
    try {
      const expired = await this.orders.expireOpenOrders(reason);
      await this.settle();
      return expired;
    } catch (err) {
      this.logger.error(`Could not expire orders: ${(err as Error).message}`);
      return 0;
    }
  }

  private async settle() {
    try {
      await this.orders.settleExpiredOptions();
    } catch (err) {
      this.logger.warn(`Option settlement failed: ${(err as Error).message}`);
    }
  }
}
