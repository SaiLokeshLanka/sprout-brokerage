import { Module } from '@nestjs/common';
import { TestHooksGuard } from '../common/test-hooks.guard';
import { MarketSimulatorService } from './market-simulator.service';
import { MarketTestController } from './market-test.controller';
import { MarketController } from './market.controller';
import { MarketGateway } from './market.gateway';
import { QuotesService } from './quotes.service';

@Module({
  controllers: [MarketController, MarketTestController],
  providers: [MarketSimulatorService, QuotesService, MarketGateway, TestHooksGuard],
  exports: [MarketSimulatorService, QuotesService],
})
export class MarketModule {}
