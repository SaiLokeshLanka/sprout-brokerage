import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import { Public } from '../common/public.decorator';
import { parseOptionSymbol } from './option-contract';
import { OptionsService } from './options.service';

class ChainQuery {
  @Matches(/^[A-Za-z]{1,20}$/, { message: 'underlying is invalid' })
  underlying!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expiry must be YYYY-MM-DD' })
  expiry?: string;
}

/** Option prices are market data, so they are public like stock quotes. */
@Public()
@Controller('options')
export class OptionsController {
  constructor(private readonly options: OptionsService) {}

  /** GET /api/options/underlyings — indices with options, their lot sizes and upcoming expiries */
  @Get('underlyings')
  underlyings() {
    return this.options.underlyings();
  }

  /** GET /api/options/chain?underlying=NIFTY&expiry=2026-10-27 — calls and puts around the current price */
  @Get('chain')
  chain(@Query() query: ChainQuery) {
    return this.options.chain(query.underlying.toUpperCase(), query.expiry);
  }

  /** GET /api/options/quote/NIFTY26102724500CE — one contract with its Greeks */
  @Get('quote/:symbol')
  quote(@Param('symbol') symbol: string) {
    const contract = parseOptionSymbol(symbol.toUpperCase());
    const quote = contract && this.options.quote(contract);
    if (!quote) throw new NotFoundException(`Unknown option contract ${symbol}`);
    return quote;
  }
}
