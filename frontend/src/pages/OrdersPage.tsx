import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, StockLogo } from '../components/common';
import { useMarket } from '../market/MarketContext';
import { Order, useTrade } from '../store/TradeContext';
import { formatINR, formatTime } from '../utils/format';

type Filter = 'ALL' | 'OPEN' | 'EXECUTED' | 'CLOSED';

const FILTERS: { key: Filter; label: string; match: (o: Order) => boolean }[] = [
  { key: 'ALL', label: 'All', match: () => true },
  { key: 'OPEN', label: 'Open', match: (o) => o.status === 'OPEN' },
  { key: 'EXECUTED', label: 'Executed', match: (o) => o.status === 'EXECUTED' },
  { key: 'CLOSED', label: 'Cancelled / Rejected', match: (o) => o.status === 'CANCELLED' || o.status === 'REJECTED' },
];

export function OrdersPage() {
  const { state, cancelOrder } = useTrade();
  const { bySymbol } = useMarket();
  const [filter, setFilter] = useState<Filter>('ALL');
  const active = FILTERS.find((f) => f.key === filter)!;
  const orders = state.orders.filter(active.match);

  return (
    <div className="page-single">
      <div className="section-head">
        <h1 className="page-title">Orders</h1>
        <div className="pill-tabs" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={`pill ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
              data-testid={`orders-filter-${f.key.toLowerCase()}`}
            >
              {f.label} ({state.orders.filter(f.match).length})
            </button>
          ))}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No orders here"
            text="Orders you place will show up on this page."
            action={
              <Link to="/" className="btn-primary inline">
                Explore stocks
              </Link>
            }
          />
        </div>
      ) : (
        <div className="card table-card">
          <table className="table" data-testid="orders-table">
            <thead>
              <tr>
                <th>Stock</th>
                <th>Type</th>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th>Status</th>
                <th className="hide-sm">Time</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} data-testid={`order-${o.id}`} data-status={o.status}>
                  <td>
                    <div className="company-cell">
                      <StockLogo symbol={o.symbol} size={28} />
                      <div>
                        <Link to={`/stocks/${o.symbol}`} className="strong plain">
                          {bySymbol[o.symbol]?.name ?? o.symbol}
                        </Link>
                        <div className="muted small">{o.product === 'DELIVERY' ? 'Delivery' : 'Intraday'}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${o.side === 'BUY' ? 'buy' : 'sell'}`}>{o.side}</span>{' '}
                    <span className="muted small">{o.orderType}</span>
                  </td>
                  <td className="num">{o.qty}</td>
                  <td className="num">
                    {o.fillPrice !== undefined ? formatINR(o.fillPrice) : o.limitPrice !== undefined ? formatINR(o.limitPrice) : 'Market'}
                    {o.status === 'OPEN' && <div className="muted small">limit</div>}
                  </td>
                  <td>
                    <span className={`status ${o.status.toLowerCase()}`} data-testid="order-status">
                      {o.status}
                    </span>
                    {o.reason && <div className="muted small">{o.reason}</div>}
                  </td>
                  <td className="hide-sm muted small">{formatTime(o.createdAt)}</td>
                  <td className="num">
                    {o.status === 'OPEN' && (
                      <button className="btn-text danger" onClick={() => cancelOrder(o.id)} data-testid="cancel-order">
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
