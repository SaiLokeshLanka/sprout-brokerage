import { Module } from '@nestjs/common';
import { TestHooksGuard } from '../common/test-hooks.guard';
import { MarketModule } from '../market/market.module';
import { AccountGateway } from './account.gateway';
import { OrderMatcherService } from './order-matcher.service';
import { OrdersTestController } from './orders-test.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [MarketModule],
  controllers: [OrdersController, OrdersTestController],
  providers: [OrdersService, OrderMatcherService, AccountGateway, TestHooksGuard],
})
export class OrdersModule {}
