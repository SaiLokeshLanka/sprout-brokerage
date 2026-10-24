import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { DateQuery, DateRangeQuery, TradesQuery } from './portfolio.dto';
import { PortfolioService } from './portfolio.service';

/** Date ranges are IST days (YYYY-MM-DD); when omitted they default to this financial year to date. */
@Controller()
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  /** GET /api/portfolio/holdings — shares at live prices, day basis, realised P&L (today and all time) */
  @Get('portfolio/holdings')
  holdings(@CurrentUser() user: AuthUser) {
    return this.portfolio.holdings(user.id);
  }

  /** GET /api/portfolio/summary — holdings + totals (invested, current, P&L, day P&L, net worth) + sector allocation */
  @Get('portfolio/summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.portfolio.summary(user.id);
  }

  /** GET /api/portfolio/trades?from&to&symbol&limit — trade book, newest first */
  @Get('portfolio/trades')
  trades(@CurrentUser() user: AuthUser, @Query() q: TradesQuery) {
    return this.portfolio.trades(user.id, q.from, q.to, q.symbol, q.limit);
  }

  /** GET /api/reports/pnl?from&to — realised P&L per stock */
  @Get('reports/pnl')
  pnl(@CurrentUser() user: AuthUser, @Query() q: DateRangeQuery) {
    return this.portfolio.pnl(user.id, q.from, q.to);
  }

  /** GET /api/reports/statement?from&to — cash account statement */
  @Get('reports/statement')
  statement(@CurrentUser() user: AuthUser, @Query() q: DateRangeQuery) {
    return this.portfolio.statement(user.id, q.from, q.to);
  }

  /** GET /api/reports/contract-note?date=YYYY-MM-DD */
  @Get('reports/contract-note')
  contractNote(@CurrentUser() user: AuthUser, @Query() q: DateQuery) {
    return this.portfolio.contractNote(user.id, q.date);
  }

  /** GET /api/reports/pnl.csv?from&to */
  @Get('reports/pnl.csv')
  async pnlCsv(@CurrentUser() user: AuthUser, @Query() q: DateRangeQuery, @Res({ passthrough: true }) res: Response) {
    return this.sendCsv(res, await this.portfolio.pnlCsv(user.id, q.from, q.to));
  }

  /** GET /api/reports/trades.csv?from&to&symbol */
  @Get('reports/trades.csv')
  async tradesCsv(@CurrentUser() user: AuthUser, @Query() q: TradesQuery, @Res({ passthrough: true }) res: Response) {
    return this.sendCsv(res, await this.portfolio.tradesCsv(user.id, q.from, q.to, q.symbol));
  }

  /** GET /api/reports/statement.csv?from&to */
  @Get('reports/statement.csv')
  async statementCsv(@CurrentUser() user: AuthUser, @Query() q: DateRangeQuery, @Res({ passthrough: true }) res: Response) {
    return this.sendCsv(res, await this.portfolio.statementCsv(user.id, q.from, q.to));
  }

  private sendCsv(res: Response, file: { filename: string; csv: string }) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return file.csv;
  }
}
