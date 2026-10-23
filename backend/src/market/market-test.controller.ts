import { Body, CanActivate, Controller, HttpCode, Injectable, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsIn, IsNumber, IsPositive, IsString } from 'class-validator';
import { Public } from '../common/public.decorator';
import { MarketSimulatorService } from './market-simulator.service';

/**
 * Hides the test hooks completely (404) unless ENABLE_TEST_HOOKS=true, and
 * always in production — they let anyone move prices.
 */
@Injectable()
export class TestHooksGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate() {
    const enabled = this.config.get('ENABLE_TEST_HOOKS') === 'true' && this.config.get('NODE_ENV') !== 'production';
    if (!enabled) throw new NotFoundException();
    return true;
  }
}

class SetPriceDto {
  @IsString()
  symbol!: string;

  /** Rupees, e.g. 2890.5 */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price!: number;
}

class SessionDto {
  @IsIn(['open', 'closed', 'auto'])
  state!: 'open' | 'closed' | 'auto';
}

/** Lets automated tests make the market deterministic: freeze it, set exact prices, open/close it. */
@Public()
@UseGuards(TestHooksGuard)
@Controller('test/market')
export class MarketTestController {
  constructor(private readonly simulator: MarketSimulatorService) {}

  /** POST /api/test/market/pause — stop random ticks */
  @Post('pause')
  @HttpCode(200)
  pause() {
    return this.simulator.setPaused(true);
  }

  /** POST /api/test/market/resume */
  @Post('resume')
  @HttpCode(200)
  resume() {
    return this.simulator.setPaused(false);
  }

  /** POST /api/test/market/price  { symbol, price } */
  @Post('price')
  @HttpCode(200)
  price(@Body() dto: SetPriceDto) {
    return this.simulator.setPrice(dto.symbol.toUpperCase(), dto.price);
  }

  /** POST /api/test/market/session  { state: 'open' | 'closed' | 'auto' } */
  @Post('session')
  @HttpCode(200)
  session(@Body() dto: SessionDto) {
    return this.simulator.setSessionOverride(dto.state === 'auto' ? null : dto.state === 'open');
  }
}
