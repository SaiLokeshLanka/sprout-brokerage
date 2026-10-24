import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date in YYYY-MM-DD format';

/** Optional IST date range. Defaults: from = start of the financial year, to = today. */
export class DateRangeQuery {
  @IsOptional()
  @Matches(DATE, { message: `from ${DATE_MESSAGE}` })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: `to ${DATE_MESSAGE}` })
  to?: string;
}

export class TradesQuery extends DateRangeQuery {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9&-]{1,20}$/, { message: 'symbol is invalid' })
  symbol?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;
}

export class DateQuery {
  @Matches(DATE, { message: `date ${DATE_MESSAGE}` })
  date!: string;
}
