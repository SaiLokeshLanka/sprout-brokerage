import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { MAX_ORDER_QTY, SYMBOL_PATTERN } from './orders.dto';

export class CreateGttDto {
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol is invalid' })
  symbol!: string;

  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL';

  @IsIn(['SINGLE', 'OCO'], { message: 'kind must be SINGLE or OCO' })
  kind!: 'SINGLE' | 'OCO';

  @IsInt({ message: 'qty must be a whole number' })
  @Min(1, { message: 'qty must be at least 1' })
  @Max(MAX_ORDER_QTY, { message: `qty can be at most ${MAX_ORDER_QTY}` })
  qty!: number;

  /** SINGLE: the trigger. OCO: the target trigger (above the current price). */
  @IsInt({ message: 'triggerPricePaise must be a whole number of paise' })
  @Min(1)
  triggerPricePaise!: number;

  /** Limit price of the order placed when the trigger is hit. */
  @IsInt({ message: 'limitPricePaise must be a whole number of paise' })
  @Min(1)
  limitPricePaise!: number;

  /** OCO only: stop-loss trigger (below the current price). */
  @IsOptional()
  @IsInt({ message: 'stopTriggerPricePaise must be a whole number of paise' })
  @Min(1)
  stopTriggerPricePaise?: number;

  /** OCO only: limit price of the stop-loss order. */
  @IsOptional()
  @IsInt({ message: 'stopLimitPricePaise must be a whole number of paise' })
  @Min(1)
  stopLimitPricePaise?: number;
}

export class ListGttQuery {
  @IsOptional()
  @IsIn(['ACTIVE', 'TRIGGERED', 'CANCELLED', 'EXPIRED', 'FAILED'])
  status?: 'ACTIVE' | 'TRIGGERED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
}
