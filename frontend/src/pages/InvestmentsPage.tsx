import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, StockLogo } from '../components/common';
import { InvestmentSummary } from '../components/InvestmentSummary';
import { STOCK_MAP } from '../data/instruments';
import { useMarket } from '../market/MarketContext';
import { useTrade } from '../store/TradeContext';
import { formatChange, formatINR, formatPaise } from '../utils/format';
import { computePortfolio } from '../utils/portfolio';

const QUICK_ADD = [10_000, 25_000, 50_000];

export function InvestmentsPage() {
  const { state, availablePaise, blockedPaise, addFunds, resetAccount } = useTrade();
  const { quotes } = useMarket();
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const p = computePortfolio(state.holdings, quotes);

  const add = (rupees: number) => {
    if (rupees > 0) addFunds(rupees);
    setAmount('');
  };

  return (
    <div className="page-grid">
      <div className="page-main">
        <InvestmentSummary />

        <section>
          <h2 className="section-title">Holdings ({p.rows.length})</h2>
          {p.rows.length === 0 ? (
            <div className="card">
              <EmptyState
                title="No holdings yet"
                text="Buy your first stock to see it here."
                action={
                  <Link to="/" className="btn-primary inline">
                    Explore stocks
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="card table-card">
              <table className="table" data-testid="holdings-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th className="num">Market price</th>
                    <th className="num hide-sm">Avg. / Qty</th>
                    <th className="num">Returns</th>
                    <th className="num hide-sm">Current</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr
                      key={r.holding.symbol}
                      className="clickable"
                      onClick={() => navigate(`/stocks/${r.holding.symbol}`)}
                      data-testid={`holding-${r.holding.symbol}`}
                    >
                      <td>
                        <div className="company-cell">
                          <StockLogo symbol={r.holding.symbol} size={32} />
                          <div>
                            <div className="strong">{STOCK_MAP[r.holding.symbol]?.name}</div>
                            <div className="muted small" data-testid="holding-qty">
                              {r.holding.qty} shares
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="num strong">{formatINR(r.ltp)}</td>
                      <td className="num hide-sm">
                        {formatINR(r.holding.avgPrice)}
                        <div className="muted small">{r.holding.qty} qty</div>
                      </td>
                      <td className={`num strong ${r.pnl >= 0 ? 'up' : 'down'}`} data-testid="holding-pnl">
                        {formatChange(r.pnl, r.pnlPct)}
                      </td>
                      <td className="num hide-sm">
                        {formatINR(r.current)}
                        <div className="muted small">{formatINR(r.invested)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside className="page-aside">
        <div className="card funds" data-testid="funds-card">
          <h3>Sprout balance</h3>
          <div className="summary-value" data-testid="funds-available">
            {formatPaise(availablePaise)}
          </div>
          <div className="muted small">Available to invest</div>
          <div className="funds-rows">
            <div>
              <span className="muted">Blocked for open orders</span>
              <span data-testid="funds-blocked">{formatPaise(blockedPaise)}</span>
            </div>
            <div>
              <span className="muted">Realised P&amp;L</span>
              <span className={state.realizedPaise >= 0 ? 'up' : 'down'} data-testid="funds-realized">
                {formatPaise(state.realizedPaise)}
              </span>
            </div>
          </div>
          <form
            className="add-money"
            onSubmit={(e) => {
              e.preventDefault();
              add(Number(amount));
            }}
          >
            <label className="field">
              <span>Add money (virtual)</span>
              <input
                type="number"
                min={1}
                placeholder="₹ Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="add-money-input"
              />
            </label>
            <div className="chip-group">
              {QUICK_ADD.map((a) => (
                <button type="button" key={a} className="chip" onClick={() => setAmount(String(a))}>
                  +{formatINR(a).replace('.00', '')}
                </button>
              ))}
            </div>
            <button type="submit" className="btn-primary" data-testid="add-money-submit">
              Add money
            </button>
          </form>
          <button
            className="btn-text danger"
            onClick={() => {
              if (window.confirm('Reset your paper account? Holdings and orders will be cleared.')) resetAccount();
            }}
            data-testid="reset-account"
          >
            Reset paper account
          </button>
        </div>
      </aside>
    </div>
  );
}
