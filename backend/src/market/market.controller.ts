import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Public } from '../common/public.decorator';
import { MarketSimulatorService } from './market-simulator.service';
import { CHART_RANGES, ChartRange } from './market.types';
import { QuotesService } from './quotes.service';

class CandlesQuery {
  @IsOptional()
  @IsIn(CHART_RANGES, { message: `range must be one of: ${CHART_RANGES.join(', ')}` })
  range?: ChartRange;
}

/** Market data is public, like on any broker's website. */
@Public()
@Controller('market')
export class MarketController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly simulator: MarketSimulatorService,
  ) {}

  /** GET /api/market/status — is the market open? */
  @Get('status')
  status() {
    return this.simulator.status();
  }

  /** GET /api/market/quotes — latest quote for every instrument */
  @Get('quotes')
  all() {
    return this.quotes.all();
  }

  /** GET /api/market/quotes/RELIANCE */
  @Get('quotes/:symbol')
  one(@Param('symbol') symbol: string) {
    return this.quotes.one(symbol.toUpperCase());
  }

  /** GET /api/market/candles/RELIANCE?range=1D|1W|1M|1Y|5Y */
  @Get('candles/:symbol')
  candles(@Param('symbol') symbol: string, @Query() query: CandlesQuery) {
    return this.simulator.candles(symbol.toUpperCase(), query.range ?? '1D');
  }
}
