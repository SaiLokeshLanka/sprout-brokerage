import { Module } from '@nestjs/common';
import { MarketSimulatorService } from './market-simulator.service';
import { MarketTestController, TestHooksGuard } from './market-test.controller';
import { MarketController } from './market.controller';
import { MarketGateway } from './market.gateway';
import { QuotesService } from './quotes.service';

@Module({
  controllers: [MarketController, MarketTestController],
  providers: [MarketSimulatorService, QuotesService, MarketGateway, TestHooksGuard],
  exports: [MarketSimulatorService, QuotesService],
})
export class MarketModule {}
