import type { Quotes } from '../market/MarketContext';
import type { Holding } from '../store/TradeContext';

export interface PortfolioRow {
  holding: Holding;
  ltp: number;
  invested: number;
  current: number;
  pnl: number;
  pnlPct: number;
  dayPnl: number;
}

export function computePortfolio(holdings: Record<string, Holding>, quotes: Quotes) {
  const rows: PortfolioRow[] = Object.values(holdings).map((holding) => {
    const q = quotes[holding.symbol];
    const ltp = q?.ltp ?? holding.avgPrice;
    const invested = holding.avgPrice * holding.qty;
    const current = ltp * holding.qty;
    const pnl = current - invested;
    return {
      holding,
      ltp,
      invested,
      current,
      pnl,
      pnlPct: invested ? (pnl / invested) * 100 : 0,
      // Same rule as the server: shares bought today are measured from their buy price, not yesterday's close.
      dayPnl: current - holding.dayBasis,
    };
  });

  const invested = rows.reduce((s, r) => s + r.invested, 0);
  const current = rows.reduce((s, r) => s + r.current, 0);
  const dayPnl = rows.reduce((s, r) => s + r.dayPnl, 0);
  const pnl = current - invested;
  const prevValue = current - dayPnl;

  return {
    rows,
    invested,
    current,
    pnl,
    pnlPct: invested ? (pnl / invested) * 100 : 0,
    dayPnl,
    dayPct: prevValue ? (dayPnl / prevValue) * 100 : 0,
  };
}
