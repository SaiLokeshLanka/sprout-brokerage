import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Matches } from 'class-validator';
import { Public } from '../common/public.decorator';
import { TestHooksGuard } from '../common/test-hooks.guard';
import { OrderMatcherService } from './order-matcher.service';
import { OrdersService } from './orders.service';

class SettleDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expiry must be YYYY-MM-DD' })
  expiry!: string;
}

/** Test-only: simulate end of day / expiry day without waiting. 404 unless ENABLE_TEST_HOOKS=true. */
@Public()
@UseGuards(TestHooksGuard)
@Controller('test')
export class OrdersTestController {
  constructor(
    private readonly matcher: OrderMatcherService,
    private readonly orders: OrdersService,
  ) {}

  /** POST /api/test/orders/expire — expire every waiting order (releases blocked money and reserved shares) */
  @Post('orders/expire')
  @HttpCode(200)
  async expire() {
    return { expired: await this.matcher.expire('Expired at end of day') };
  }

  /** POST /api/test/options/settle { expiry } — settle every position in contracts with this expiry, now */
  @Post('options/settle')
  @HttpCode(200)
  async settle(@Body() dto: SettleDto) {
    return { settled: await this.orders.settleExpiredOptions(dto.expiry) };
  }
}
