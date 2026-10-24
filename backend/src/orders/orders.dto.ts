import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export const ORDER_STATUSES = ['TRIGGER_PENDING', 'OPEN', 'EXECUTED', 'CANCELLED', 'EXPIRED', 'REJECTED'] as const;
export const ORDER_TYPES = ['MARKET', 'LIMIT', 'SL', 'SL_M'] as const;
export type OrderTypeName = (typeof ORDER_TYPES)[number];
export const MAX_ORDER_QTY = 100_000;
/** Stocks (RELIANCE) and option contracts (NIFTY26102724500CE). */
export const SYMBOL_PATTERN = /^[A-Za-z0-9&-]{1,30}$/;

export class PlaceOrderDto {
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol is invalid' })
  symbol!: string;

  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL';

  @IsIn(ORDER_TYPES, { message: `orderType must be one of: ${ORDER_TYPES.join(', ')}` })
  orderType!: OrderTypeName;

  @IsOptional()
  @IsIn(['DELIVERY', 'INTRADAY'])
  product?: 'DELIVERY' | 'INTRADAY';

  @IsInt({ message: 'qty must be a whole number' })
  @Min(1, { message: 'qty must be at least 1' })
  @Max(MAX_ORDER_QTY, { message: `qty can be at most ${MAX_ORDER_QTY}` })
  qty!: number;

  /** Required for LIMIT and SL orders; integer paise on the instrument's tick size. */
  @IsOptional()
  @IsInt({ message: 'limitPricePaise must be a whole number of paise' })
  @Min(1)
  limitPricePaise?: number;

  /** Required for SL and SL_M orders: the price that activates the order. */
  @IsOptional()
  @IsInt({ message: 'triggerPricePaise must be a whole number of paise' })
  @Min(1)
  triggerPricePaise?: number;
}

export class ListOrdersQuery {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: (typeof ORDER_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
