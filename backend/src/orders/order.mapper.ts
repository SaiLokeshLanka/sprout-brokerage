import { Order } from '@prisma/client';

/** The order shape returned by the API and pushed over the account WebSocket. */
export function toOrderView(o: Order) {
  return {
    id: o.id,
    symbol: o.symbol,
    side: o.side,
    orderType: o.orderType,
    product: o.product,
    qty: o.qty,
    limitPricePaise: o.limitPricePaise,
    triggerPricePaise: o.triggerPricePaise,
    status: o.status,
    fillPricePaise: o.fillPricePaise,
    blockedPaise: Number(o.blockedPaise),
    chargesPaise: Number(o.chargesPaise),
    statusReason: o.statusReason,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    executedAt: o.executedAt,
  };
}

export type OrderView = ReturnType<typeof toOrderView>;

/** A limit order can fill: buy at or below its limit, sell at or above it. */
export const isMarketable = (side: 'BUY' | 'SELL', limitPaise: number, ltpPaise: number) =>
  side === 'BUY' ? ltpPaise <= limitPaise : ltpPaise >= limitPaise;

/** A stop order activates: a stop-loss sell when the price falls to the trigger, a stop buy when it rises to it. */
export const isTriggered = (side: 'BUY' | 'SELL', triggerPaise: number, ltpPaise: number) =>
  side === 'BUY' ? ltpPaise >= triggerPaise : ltpPaise <= triggerPaise;
