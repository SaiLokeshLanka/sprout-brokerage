import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Change, StockCard, StockLogo } from '../components/common';
import { InvestmentSummary } from '../components/InvestmentSummary';
import { INDICES, MOST_TRADED, STOCKS } from '../data/instruments';
import { changeOf, useMarket } from '../market/MarketContext';
import { useTrade } from '../store/TradeContext';
import { formatINR, formatNum } from '../utils/format';

export function ExplorePage() {
  const { quotes } = useMarket();
  const { state, toggleWatchlist } = useTrade();
  const navigate = useNavigate();
  const [movers, setMovers] = useState<'gainers' | 'losers'>('gainers');

  const ranked = STOCKS.map((s) => ({ symbol: s.symbol, ...changeOf(quotes[s.symbol]) })).sort((a, b) => b.pct - a.pct);
  const moverList = (movers === 'gainers' ? ranked : [...ranked].reverse()).slice(0, 4);

  return (
    <div className="page-grid">
      <div className="page-main">
        <section className="index-strip" data-testid="index-strip">
          {INDICES.map((idx) => {
            const q = quotes[idx.symbol];
            const { abs, pct } = changeOf(q);
            return (
              <div key={idx.symbol} className="card index-card" data-testid={`index-${idx.symbol}`}>
                <div className="muted small strong">{idx.name}</div>
                <div className="index-value">{formatNum(q.ltp)}</div>
                <Change abs={abs} pct={pct} />
              </div>
            );
          })}
        </section>

        <section>
          <h2 className="section-title">Most traded on Sprout</h2>
          <div className="card-grid" data-testid="most-traded">
            {MOST_TRADED.map((s) => (
              <StockCard key={s} symbol={s} />
            ))}
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2 className="section-title">Top movers today</h2>
            <div className="pill-tabs" role="tablist">
              {(['gainers', 'losers'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={movers === m}
                  className={`pill ${movers === m ? 'active' : ''}`}
                  onClick={() => setMovers(m)}
                  data-testid={`movers-${m}`}
                >
                  {m === 'gainers' ? 'Gainers' : 'Losers'}
                </button>
              ))}
            </div>
          </div>
          <div className="card-grid" data-testid="top-movers">
            {moverList.map((m) => (
              <StockCard key={m.symbol} symbol={m.symbol} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="section-title">All stocks</h2>
          <div className="card table-card">
            <table className="table" data-testid="all-stocks-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="num">Market price</th>
                  <th className="num hide-sm">1D change</th>
                  <th className="num" aria-label="Watchlist" />
                </tr>
              </thead>
              <tbody>
                {STOCKS.map((s) => {
                  const q = quotes[s.symbol];
                  const { abs, pct } = changeOf(q);
                  const watched = state.watchlist.includes(s.symbol);
                  return (
                    <tr key={s.symbol} className="clickable" onClick={() => navigate(`/stocks/${s.symbol}`)} data-testid={`row-${s.symbol}`}>
                      <td>
                        <div className="company-cell">
                          <StockLogo symbol={s.symbol} size={32} />
                          <div>
                            <Link to={`/stocks/${s.symbol}`} className="strong plain" onClick={(e) => e.stopPropagation()}>
                              {s.name}
                            </Link>
                            <div className="muted small">{s.symbol}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num strong">
                        {formatINR(q.ltp)}
                        <div className="show-sm small">
                          <Change abs={abs} pct={pct} />
                        </div>
                      </td>
                      <td className="num hide-sm">
                        <Change abs={abs} pct={pct} />
                      </td>
                      <td className="num">
                        <button
                          className={`star ${watched ? 'on' : ''}`}
                          aria-label={watched ? `Remove ${s.symbol} from watchlist` : `Add ${s.symbol} to watchlist`}
                          aria-pressed={watched}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWatchlist(s.symbol);
                          }}
                          data-testid={`watch-toggle-${s.symbol}`}
                        >
                          {watched ? '★' : '☆'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <aside className="page-aside">
        <InvestmentSummary compact />
        <div className="card note">
          <div className="strong">Paper trading</div>
          <p className="muted small">
            Prices are simulated and refresh every 1.5s. Orders use virtual money only.
          </p>
        </div>
      </aside>
    </div>
  );
}
