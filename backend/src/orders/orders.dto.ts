import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export const ORDER_STATUSES = ['OPEN', 'EXECUTED', 'CANCELLED', 'EXPIRED', 'REJECTED'] as const;
export const MAX_ORDER_QTY = 100_000;

export class PlaceOrderDto {
  @IsString()
  @Matches(/^[A-Za-z0-9&-]{1,20}$/, { message: 'symbol is invalid' })
  symbol!: string;

  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL';

  @IsIn(['MARKET', 'LIMIT'])
  orderType!: 'MARKET' | 'LIMIT';

  @IsOptional()
  @IsIn(['DELIVERY', 'INTRADAY'])
  product?: 'DELIVERY' | 'INTRADAY';

  @IsInt({ message: 'qty must be a whole number' })
  @Min(1, { message: 'qty must be at least 1' })
  @Max(MAX_ORDER_QTY, { message: `qty can be at most ${MAX_ORDER_QTY}` })
  qty!: number;

  /** Required for LIMIT orders; integer paise on the instrument's tick size. */
  @IsOptional()
  @IsInt({ message: 'limitPricePaise must be a whole number of paise' })
  @Min(1)
  limitPricePaise?: number;
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
