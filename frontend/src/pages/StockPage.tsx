import { Link, useParams } from 'react-router-dom';
import { Change, StockLogo } from '../components/common';
import { OrderPanel } from '../components/OrderPanel';
import { PriceChart } from '../components/PriceChart';
import { STOCK_MAP } from '../data/instruments';
import { changeOf, useQuote } from '../market/MarketContext';
import { useTrade } from '../store/TradeContext';
import { formatChange, formatINR, formatInt, formatTime } from '../utils/format';

export function StockPage() {
  const { symbol = '' } = useParams();
  const inst = STOCK_MAP[symbol];
  const q = useQuote(symbol);
  const { state, toggleWatchlist } = useTrade();

  if (!inst || !q) {
    return (
      <div className="card empty-state" data-testid="stock-not-found">
        <h3>Stock not found</h3>
        <p className="muted">We couldn't find “{symbol}”.</p>
        <Link to="/" className="btn-primary inline">
          Explore stocks
        </Link>
      </div>
    );
  }

  const { abs, pct } = changeOf(q);
  const watched = state.watchlist.includes(symbol);
  const holding = state.holdings[symbol];
  const recentOrders = state.orders.filter((o) => o.symbol === symbol).slice(0, 5);
  const rangePos = q.high > q.low ? ((q.ltp - q.low) / (q.high - q.low)) * 100 : 50;

  return (
    <div className="page-grid">
      <div className="page-main">
        <section className="stock-header">
          <div className="stock-header-top">
            <StockLogo symbol={symbol} size={52} />
            <button
              className={`watch-btn ${watched ? 'on' : ''}`}
              onClick={() => toggleWatchlist(symbol)}
              aria-pressed={watched}
              data-testid="watchlist-toggle"
            >
              {watched ? '★ Watchlisted' : '☆ Watchlist'}
            </button>
          </div>
          <h1 className="stock-name" data-testid="stock-name">
            {inst.name}
          </h1>
          <div className="stock-price" data-testid="stock-ltp">
            {formatINR(q.ltp)}
          </div>
          <div className="small">
            <Change abs={abs} pct={pct} testId="stock-change" /> <span className="muted">1D</span>
          </div>
        </section>

        <PriceChart symbol={symbol} ltp={q.ltp} open={q.open} />

        {holding && (
          <section className="card position-card" data-testid="your-position">
            <h3>Your investment</h3>
            <div className="stats-grid">
              <Stat label="Shares" value={formatInt(holding.qty)} />
              <Stat label="Avg. price" value={formatINR(holding.avgPrice)} />
              <Stat label="Current value" value={formatINR(holding.qty * q.ltp)} />
              <div>
                <div className="muted small">Returns</div>
                {(() => {
                  const pnl = (q.ltp - holding.avgPrice) * holding.qty;
                  return (
                    <div className={pnl >= 0 ? 'up strong' : 'down strong'}>
                      {formatChange(pnl, (pnl / (holding.avgPrice * holding.qty)) * 100)}
                    </div>
                  );
                })()}
              </div>
            </div>
          </section>
        )}

        <section>
          <h2 className="section-title">Performance</h2>
          <div className="range-bar-wrap">
            <div className="range-label">
              <span className="muted small">Today's low</span>
              <span className="strong">{formatINR(q.low)}</span>
            </div>
            <div className="range-bar">
              <div className="range-marker" style={{ left: `${rangePos}%` }} />
            </div>
            <div className="range-label right">
              <span className="muted small">Today's high</span>
              <span className="strong">{formatINR(q.high)}</span>
            </div>
          </div>
          <div className="stats-grid" data-testid="performance">
            <Stat label="Open" value={formatINR(q.open)} />
            <Stat label="Prev. close" value={formatINR(q.prevClose)} />
            <Stat label="Volume" value={formatInt(q.volume)} />
            <Stat label="Exchange" value="NSE" />
          </div>
        </section>

        <section>
          <h2 className="section-title">Fundamentals</h2>
          <div className="stats-grid" data-testid="fundamentals">
            <Stat label="Market cap" value={inst.marketCap} />
            <Stat label="P/E ratio" value={inst.pe.toFixed(2)} />
            <Stat label="Sector" value={inst.sector} />
            <Stat label="Symbol" value={inst.symbol} />
          </div>
        </section>

        {recentOrders.length > 0 && (
          <section>
            <h2 className="section-title">Your recent orders</h2>
            <div className="card list-card">
              {recentOrders.map((o) => (
                <div key={o.id} className="list-row">
                  <span className={`badge ${o.side === 'BUY' ? 'buy' : 'sell'}`}>{o.side}</span>
                  <span>
                    {o.qty} @ {o.orderType === 'LIMIT' ? formatINR(o.limitPrice!) : 'Market'}
                  </span>
                  <span className={`status ${o.status.toLowerCase()}`}>{o.status}</span>
                  <span className="muted small">{formatTime(o.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="page-aside sticky">
        <OrderPanel symbol={symbol} ltp={q.ltp} />
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted small">{label}</div>
      <div className="strong">{value}</div>
    </div>
  );
}
