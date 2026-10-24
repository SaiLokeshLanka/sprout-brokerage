import { Module } from '@nestjs/common';
import { TestHooksGuard } from '../common/test-hooks.guard';
import { MarketModule } from '../market/market.module';
import { OptionsModule } from '../options/options.module';
import { AccountGateway } from './account.gateway';
import { GttController } from './gtt.controller';
import { GttService } from './gtt.service';
import { OrderMatcherService } from './order-matcher.service';
import { OrdersTestController } from './orders-test.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [MarketModule, OptionsModule],
  controllers: [OrdersController, GttController, OrdersTestController],
  providers: [OrdersService, GttService, OrderMatcherService, AccountGateway, TestHooksGuard],
})
export class OrdersModule {}
