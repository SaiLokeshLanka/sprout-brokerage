import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, StockLogo } from '../components/common';
import { useMarket } from '../market/MarketContext';
import { Gtt, isWaiting, Order, useTrade } from '../store/TradeContext';
import { formatINR, formatPaise, formatTime } from '../utils/format';
import { optionName, parseOptionSymbol } from '../utils/options';

type Filter = 'ALL' | 'OPEN' | 'EXECUTED' | 'CLOSED' | 'GTT';

const FILTERS: { key: Exclude<Filter, 'GTT'>; label: string; match: (o: Order) => boolean }[] = [
  { key: 'ALL', label: 'All', match: () => true },
  { key: 'OPEN', label: 'Open', match: isWaiting },
  { key: 'EXECUTED', label: 'Executed', match: (o) => o.status === 'EXECUTED' },
  { key: 'CLOSED', label: 'Cancelled / Expired / Rejected', match: (o) => ['CANCELLED', 'EXPIRED', 'REJECTED'].includes(o.status) },
];

const TYPE_LABEL: Record<Order['orderType'], string> = { MARKET: 'MARKET', LIMIT: 'LIMIT', SL: 'SL', SL_M: 'SL-M' };
const statusLabel = (s: string) => s.replace('_', ' ');

/** Stock name, or a readable option contract name. */
function useInstrumentName() {
  const { bySymbol } = useMarket();
  return (symbol: string) => optionName(symbol) ?? bySymbol[symbol]?.name ?? symbol;
}

const linkFor = (symbol: string) => {
  const c = parseOptionSymbol(symbol);
  return c ? `/options?underlying=${c.underlying}&expiry=${c.expiry}` : `/stocks/${symbol}`;
};

export function OrdersPage() {
  const { state, cancelOrder } = useTrade();
  const nameOf = useInstrumentName();
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get('tab') === 'gtt' ? 'GTT' : ((params.get('filter') as Filter) ?? 'ALL');
  const setFilter = (f: Filter) => setParams(f === 'GTT' ? { tab: 'gtt' } : f === 'ALL' ? {} : { filter: f }, { replace: true });
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const orders = state.orders.filter(active.match);

  const cancel = async (id: string) => {
    setCancelling(id);
    setNotice(await cancelOrder(id));
    setCancelling(null);
  };

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
          <button
            role="tab"
            aria-selected={filter === 'GTT'}
            className={`pill ${filter === 'GTT' ? 'active' : ''}`}
            onClick={() => setFilter('GTT')}
            data-testid="orders-filter-gtt"
          >
            GTT ({state.gtts.filter((g) => g.status === 'ACTIVE').length} active)
          </button>
        </div>
      </div>

      {notice && (
        <div className={`order-result ${notice.ok ? 'ok' : 'err'}`} role="status" data-testid="orders-notice">
          {notice.message}
        </div>
      )}

      {filter === 'GTT' ? (
        <GttTable gtts={state.gtts} onNotice={setNotice} />
      ) : orders.length === 0 ? (
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
                <th>Instrument</th>
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
                        <Link to={linkFor(o.symbol)} className="strong plain">
                          {nameOf(o.symbol)}
                        </Link>
                        <div className="muted small">{parseOptionSymbol(o.symbol) ? 'F&O' : o.product === 'DELIVERY' ? 'Delivery' : 'Intraday'}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${o.side === 'BUY' ? 'buy' : 'sell'}`}>{o.side}</span>{' '}
                    <span className="muted small" data-testid="order-type">
                      {TYPE_LABEL[o.orderType]}
                    </span>
                  </td>
                  <td className="num">{o.qty}</td>
                  <td className="num" data-testid="order-price">
                    {o.fillPrice !== undefined ? formatINR(o.fillPrice) : o.limitPrice !== undefined ? formatINR(o.limitPrice) : 'Market'}
                    {o.status === 'OPEN' && <div className="muted small">limit</div>}
                    {o.triggerPrice !== undefined && o.status !== 'EXECUTED' && (
                      <div className="muted small" data-testid="order-trigger">
                        trigger {formatINR(o.triggerPrice)}
                      </div>
                    )}
                    {o.chargesPaise > 0 && (
                      <div className="muted small" data-testid="order-charges">
                        charges {formatPaise(o.chargesPaise)}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`status ${o.status.toLowerCase()}`} data-testid="order-status">
                      {statusLabel(o.status)}
                    </span>
                    {o.reason && <div className="muted small">{o.reason}</div>}
                  </td>
                  <td className="hide-sm muted small">{formatTime(o.createdAt)}</td>
                  <td className="num">
                    {isWaiting(o) && (
                      <button
                        className="btn-text danger"
                        onClick={() => cancel(o.id)}
                        disabled={cancelling === o.id}
                        data-testid="cancel-order"
                      >
                        {cancelling === o.id ? 'Cancelling…' : 'Cancel'}
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

function GttTable({ gtts, onNotice }: { gtts: Gtt[]; onNotice: (n: { ok: boolean; message: string }) => void }) {
  const { cancelGtt } = useTrade();
  const nameOf = useInstrumentName();
  const [cancelling, setCancelling] = useState<string | null>(null);

  if (gtts.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No GTTs yet"
          text="A GTT (Good Till Triggered) waits up to a year for your price, then places the order. Create one from a stock's order panel."
        />
      </div>
    );
  }

  const cancel = async (id: string) => {
    setCancelling(id);
    onNotice(await cancelGtt(id));
    setCancelling(null);
  };

  return (
    <div className="card table-card">
      <table className="table" data-testid="gtt-table">
        <thead>
          <tr>
            <th>Stock</th>
            <th>Type</th>
            <th className="num">Qty</th>
            <th className="num">Trigger → limit</th>
            <th>Status</th>
            <th className="hide-sm">Created</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {gtts.map((g) => (
            <tr key={g.id} data-testid={`gtt-${g.id}`} data-status={g.status}>
              <td>
                <Link to={`/stocks/${g.symbol}`} className="strong plain">
                  {nameOf(g.symbol)}
                </Link>
              </td>
              <td>
                <span className={`badge ${g.side === 'BUY' ? 'buy' : 'sell'}`}>{g.side}</span>{' '}
                <span className="muted small">{g.kind === 'OCO' ? 'OCO' : 'Single'}</span>
              </td>
              <td className="num">{g.qty}</td>
              <td className="num" data-testid="gtt-prices">
                <div>
                  {g.kind === 'OCO' && <span className="muted small">Target </span>}
                  {formatINR(g.trigger)} → {formatINR(g.limit)}
                </div>
                {g.kind === 'OCO' && (
                  <div>
                    <span className="muted small">Stop-loss </span>
                    {formatINR(g.stopTrigger!)} → {formatINR(g.stopLimit!)}
                  </div>
                )}
              </td>
              <td>
                <span className={`status ${g.status.toLowerCase()}`} data-testid="gtt-status">
                  {g.status}
                </span>
                {g.triggeredLeg && g.triggeredLeg !== 'SINGLE' && (
                  <div className="muted small">{g.triggeredLeg === 'TARGET' ? 'Target hit' : 'Stop-loss hit'}</div>
                )}
                {g.reason && <div className="muted small">{g.reason}</div>}
                {g.status === 'ACTIVE' && <div className="muted small">until {new Date(g.expiresAt).toLocaleDateString('en-IN')}</div>}
              </td>
              <td className="hide-sm muted small">{formatTime(g.createdAt)}</td>
              <td className="num">
                {g.status === 'ACTIVE' && (
                  <button className="btn-text danger" onClick={() => cancel(g.id)} disabled={cancelling === g.id} data-testid="cancel-gtt">
                    {cancelling === g.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
