import { Link, useParams } from 'react-router-dom';
import { Change, MarketStatusPill, StockLogo } from '../components/common';
import { OrderPanel } from '../components/OrderPanel';
import { PriceChart } from '../components/PriceChart';
import { changeOf, useInstrument, useQuote } from '../market/MarketContext';
import { useTrade } from '../store/TradeContext';
import { formatChange, formatINR, formatInt, formatTime } from '../utils/format';

export function StockPage() {
  const symbol = (useParams().symbol ?? '').toUpperCase();
  const inst = useInstrument(symbol);
  const q = useQuote(symbol);
  const { state, toggleWatchlist } = useTrade();

  if (inst && !q) {
    return (
      <div className="card empty-state muted" data-testid="prices-loading">
        Loading live price…
      </div>
    );
  }

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
  const tradable = inst.type === 'EQUITY';

  return (
    <div className="page-grid">
      <div className="page-main">
        <section className="stock-header">
          <div className="stock-header-top">
            <StockLogo symbol={symbol} size={52} />
            {tradable && (
              <button
                className={`watch-btn ${watched ? 'on' : ''}`}
                onClick={() => toggleWatchlist(symbol)}
                aria-pressed={watched}
                data-testid="watchlist-toggle"
              >
                {watched ? '★ Watchlisted' : '☆ Watchlist'}
              </button>
            )}
          </div>
          <h1 className="stock-name" data-testid="stock-name">
            {inst.name}
          </h1>
          <div className="stock-price" data-testid="stock-ltp">
            {formatINR(q.ltp)}
          </div>
          <div className="small stock-sub">
            <span>
              <Change abs={abs} pct={pct} testId="stock-change" /> <span className="muted">1D</span>
            </span>
            <MarketStatusPill />
          </div>
        </section>

        <PriceChart symbol={symbol} ltp={q.ltp} />

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
            <Stat label="Exchange" value={inst.exchange} />
            {q.lowerCircuit !== null && q.upperCircuit !== null && (
              <>
                <Stat label="Lower circuit" value={formatINR(q.lowerCircuit)} testId="lower-circuit" />
                <Stat label="Upper circuit" value={formatINR(q.upperCircuit)} testId="upper-circuit" />
              </>
            )}
          </div>
        </section>

        {tradable && (
          <section>
            <h2 className="section-title">Fundamentals</h2>
            <div className="stats-grid" data-testid="fundamentals">
              <Stat label="Market cap" value={inst.marketCapCr === null ? '—' : `₹${formatInt(inst.marketCapCr)} Cr`} />
              <Stat label="P/E ratio" value={inst.peRatio === null ? '—' : inst.peRatio.toFixed(2)} />
              <Stat label="Sector" value={inst.sector ?? '—'} testId="sector" />
              <Stat label="Lot size" value={formatInt(inst.lotSize)} />
            </div>
          </section>
        )}

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
        {tradable ? (
          <OrderPanel symbol={symbol} ltp={q.ltp} />
        ) : (
          <div className="card note" data-testid="index-note">
            <div className="strong">{inst.name} is an index</div>
            <p className="muted small">Indices track a basket of stocks and can't be bought directly.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <div className="muted small">{label}</div>
      <div className="strong" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}
