import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { InstrumentType } from '@prisma/client';
import { Public } from '../common/public.decorator';
import { InstrumentsService } from './instruments.service';

@Public()
@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  /** GET /api/instruments?type=EQUITY|INDEX&q=reli */
  @Get()
  list(@Query('type') type?: string, @Query('q') q?: string) {
    if (type && !(type in InstrumentType)) {
      throw new BadRequestException(`type must be one of: ${Object.keys(InstrumentType).join(', ')}`);
    }
    return this.instruments.list({ type: type as InstrumentType | undefined, q: q?.trim() || undefined });
  }

  /** GET /api/instruments/RELIANCE */
  @Get(':symbol')
  get(@Param('symbol') symbol: string) {
    return this.instruments.getBySymbol(symbol);
  }
}
