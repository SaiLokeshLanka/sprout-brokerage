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
    status: o.status,
    fillPricePaise: o.fillPricePaise,
    blockedPaise: Number(o.blockedPaise),
    statusReason: o.statusReason,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    executedAt: o.executedAt,
  };
}

export type OrderView = ReturnType<typeof toOrderView>;

export const isMarketable = (side: 'BUY' | 'SELL', limitPaise: number, ltpPaise: number) =>
  side === 'BUY' ? ltpPaise <= limitPaise : ltpPaise >= limitPaise;
