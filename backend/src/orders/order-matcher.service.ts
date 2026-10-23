import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MarketSimulatorService } from '../market/market-simulator.service';
import { PrismaService } from '../prisma/prisma.service';
import { isMarketable } from './order.mapper';
import { OrdersService } from './orders.service';

/**
 * Runs after every price tick: fills OPEN limit orders whose price has been reached,
 * oldest first, at the current market price. Works whether or not the user's browser is open.
 * Also expires open orders when the market closes or a new trading day starts.
 */
@Injectable()
export class OrderMatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderMatcherService.name);
  private running = false;
  private runAgain = false;

  private readonly onTick = () => void this.run();
  private readonly onClose = () => void this.expire('Expired — market closed');
  private readonly onRollover = () => void this.expire('Expired at end of day');

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulator: MarketSimulatorService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    this.simulator.events.on('tick', this.onTick);
    this.simulator.events.on('session-closed', this.onClose);
    this.simulator.events.on('rollover', this.onRollover);
  }

  onModuleDestroy() {
    this.simulator.events.off('tick', this.onTick);
    this.simulator.events.off('session-closed', this.onClose);
    this.simulator.events.off('rollover', this.onRollover);
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
        const open = await this.prisma.order.findMany({
          where: { status: 'OPEN' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, symbol: true, side: true, limitPricePaise: true },
        });
        for (const o of open) {
          const quote = this.simulator.getQuote(o.symbol);
          if (!quote || o.limitPricePaise === null || !isMarketable(o.side, o.limitPricePaise, quote.ltpPaise)) continue;
          await this.orders.fillOpenOrder(o.id, quote.ltpPaise).catch((err: Error) => {
            this.logger.error(`Could not fill order ${o.id}: ${err.message}`);
          });
        }
      } while (this.runAgain);
    } catch (err) {
      this.logger.warn(`Matching pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async expire(reason: string) {
    try {
      return await this.orders.expireOpenOrders(reason);
    } catch (err) {
      this.logger.error(`Could not expire orders: ${(err as Error).message}`);
      return 0;
    }
  }
}
