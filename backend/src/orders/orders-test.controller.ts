import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { TestHooksGuard } from '../common/test-hooks.guard';
import { OrderMatcherService } from './order-matcher.service';

/** Test-only: simulate end of day without waiting for midnight. 404 unless ENABLE_TEST_HOOKS=true. */
@Public()
@UseGuards(TestHooksGuard)
@Controller('test/orders')
export class OrdersTestController {
  constructor(private readonly matcher: OrderMatcherService) {}

  /** POST /api/test/orders/expire — expire every OPEN order (releases blocked money and reserved shares) */
  @Post('expire')
  @HttpCode(200)
  async expire() {
    return { expired: await this.matcher.expire('Expired at end of day') };
  }
}
