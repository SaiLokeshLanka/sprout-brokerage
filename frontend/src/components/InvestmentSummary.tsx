import { Link } from 'react-router-dom';
import { useMarket } from '../market/MarketContext';
import { useTrade } from '../store/TradeContext';
import { computePortfolio } from '../utils/portfolio';
import { formatChange, formatINR } from '../utils/format';

export function InvestmentSummary({ compact = false }: { compact?: boolean }) {
  const { state } = useTrade();
  const { quotes } = useMarket();
  const p = computePortfolio(state.holdings, quotes);

  return (
    <div className="card summary" data-testid="investment-summary">
      <div className="summary-head">
        <h3>Your investments</h3>
        {compact && (
          <Link to="/investments" className="link small">
            Dashboard
          </Link>
        )}
      </div>
      <div className="summary-value" data-testid="portfolio-current">
        {formatINR(p.current)}
      </div>
      <div className="muted small">Current value</div>
      <div className="summary-grid">
        <div>
          <div className="muted small">Invested</div>
          <div className="strong" data-testid="portfolio-invested">{formatINR(p.invested)}</div>
        </div>
        <div>
          <div className="muted small">Total returns</div>
          <div className={p.pnl >= 0 ? 'up strong' : 'down strong'} data-testid="portfolio-pnl">
            {formatChange(p.pnl, p.pnlPct)}
          </div>
        </div>
        <div>
          <div className="muted small">1D returns</div>
          <div className={p.dayPnl >= 0 ? 'up strong' : 'down strong'} data-testid="portfolio-day-pnl">
            {formatChange(p.dayPnl, p.dayPct)}
          </div>
        </div>
      </div>
    </div>
  );
}
