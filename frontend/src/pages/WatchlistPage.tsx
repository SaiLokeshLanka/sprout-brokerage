import { Link } from 'react-router-dom';
import { Change, EmptyState, StockLogo } from '../components/common';
import { changeOf, useMarket } from '../market/MarketContext';
import { useTrade } from '../store/TradeContext';
import { formatINR } from '../utils/format';

export function WatchlistPage() {
  const { state, toggleWatchlist } = useTrade();
  const { quotes, bySymbol } = useMarket();

  return (
    <div className="page-single narrow">
      <h1 className="page-title">Watchlist</h1>
      <div className="card list-card" data-testid="watchlist">
        {state.watchlist.length === 0 ? (
          <EmptyState
            title="Your watchlist is empty"
            text="Tap the star on any stock to track it here."
            action={
              <Link to="/" className="btn-primary inline">
                Explore stocks
              </Link>
            }
          />
        ) : (
          state.watchlist.map((symbol) => {
            const q = quotes[symbol];
            if (!q) return null;
            const { abs, pct } = changeOf(q);
            return (
              <div key={symbol} className="watch-row" data-testid={`watch-${symbol}`}>
                <Link to={`/stocks/${symbol}`} className="watch-link plain">
                  <StockLogo symbol={symbol} size={36} />
                  <div className="grow">
                    <div className="strong">{bySymbol[symbol]?.name ?? symbol}</div>
                    <div className="muted small">{symbol}</div>
                  </div>
                  <div className="num">
                    <div className="strong">{formatINR(q.ltp)}</div>
                    <div className="small">
                      <Change abs={abs} pct={pct} />
                    </div>
                  </div>
                </Link>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${symbol} from watchlist`}
                  onClick={() => toggleWatchlist(symbol)}
                  data-testid={`watch-remove-${symbol}`}
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
