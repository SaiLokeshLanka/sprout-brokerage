import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, downloadFile, errorMessage } from '../api/client';
import { formatPaise, formatTime } from '../utils/format';

type Tab = 'pnl' | 'trades' | 'statement';

interface PnlReport {
  from: string;
  to: string;
  rows: {
    symbol: string;
    name: string;
    trades: number;
    buyQty: number;
    avgBuyPaise: number | null;
    sellQty: number;
    avgSellPaise: number | null;
    realizedPnlPaise: number;
  }[];
  totals: { trades: number; turnoverPaise: number; realizedPnlPaise: number; chargesPaise: number };
}

interface TradeBook {
  trades: {
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: string;
    qty: number;
    pricePaise: number;
    valuePaise: number;
    realizedPnlPaise: number | null;
    createdAt: string;
  }[];
}

interface Statement {
  openingBalancePaise: number;
  closingBalancePaise: number;
  creditsPaise: number;
  debitsPaise: number;
  items: { id: string; type: string; description: string; amountPaise: number; balanceAfterPaise: number; createdAt: string }[];
}

/** Today's date in India (YYYY-MM-DD), whatever the computer's timezone. */
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const daysAgoIst = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);
/** Indian financial year starts on 1 April. */
const fyStart = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
};
/** The IST calendar date of an instant. */
const istDateOf = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);

const PRESETS = [
  { label: 'This financial year', range: () => [fyStart(todayIst()), todayIst()] },
  { label: 'Last 30 days', range: () => [daysAgoIst(29), todayIst()] },
  { label: 'Today', range: () => [todayIst(), todayIst()] },
] as const;

const signed = (paise: number) => <span className={paise >= 0 ? 'up' : 'down'}>{formatPaise(paise)}</span>;

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (['pnl', 'trades', 'statement'].includes(params.get('tab') ?? '') ? params.get('tab') : 'pnl') as Tab;
  const [from, setFrom] = useState(fyStart(todayIst()));
  const [to, setTo] = useState(todayIst());
  // Each result remembers the request it answers. Right after a tab or date change React renders
  // once before the new request finishes; matching the key stops a view getting another tab's data.
  const [result, setResult] = useState<{ key: string; data?: PnlReport | TradeBook | Statement; error?: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const query = `from=${from}&to=${to}`;
  const endpoint = { pnl: '/reports/pnl', trades: '/portfolio/trades', statement: '/reports/statement' }[tab];
  const csv = { pnl: '/reports/pnl.csv', trades: '/reports/trades.csv', statement: '/reports/statement.csv' }[tab];
  const key = `${endpoint}?${query}`;

  useEffect(() => {
    let cancelled = false;
    api
      .get<PnlReport | TradeBook | Statement>(key)
      .then((data) => !cancelled && setResult({ key, data }))
      .catch((err) => !cancelled && setResult({ key, error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = result?.key === key ? result : null;
  const status = !current ? 'loading' : current.error ? 'error' : 'ready';
  const data = current?.data ?? null;
  const error = downloadError || current?.error || '';

  const download = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      await downloadFile(`${csv}?${query}`, `sprout-${tab}.csv`);
    } catch (err) {
      setDownloadError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="page-single">
      <div className="section-head">
        <h1 className="page-title">Reports</h1>
        <div className="pill-tabs" role="tablist">
          {(
            [
              ['pnl', 'P&L'],
              ['trades', 'Trade book'],
              ['statement', 'Statement'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`pill ${tab === key ? 'active' : ''}`}
              onClick={() => setParams({ tab: key }, { replace: true })}
              data-testid={`report-tab-${key}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card report-filters">
        <label className="field">
          <span>From</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} data-testid="report-from" />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={to} min={from} max={todayIst()} onChange={(e) => setTo(e.target.value)} data-testid="report-to" />
        </label>
        <div className="chip-group">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip"
              onClick={() => {
                const [f, t] = p.range();
                setFrom(f);
                setTo(t);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button className="btn-outline download-btn" onClick={download} disabled={downloading || status !== 'ready'} data-testid="report-download">
          {downloading ? 'Preparing…' : '⬇ Download CSV'}
        </button>
      </div>

      {status === 'loading' && <div className="card empty-state muted">Loading…</div>}
      {error && (
        <div className="order-result err" role="alert" data-testid="report-error">
          {error}
        </div>
      )}
      {status === 'ready' && tab === 'pnl' && <PnlView report={data as PnlReport} />}
      {status === 'ready' && tab === 'trades' && <TradesView book={data as TradeBook} />}
      {status === 'ready' && tab === 'statement' && <StatementView statement={data as Statement} />}
    </div>
  );
}

function Stat({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="card report-stat">
      <div className="muted small">{label}</div>
      <div className="report-stat-value" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

function PnlView({ report }: { report: PnlReport }) {
  return (
    <>
      <div className="report-stats">
        <Stat label="Realised P&L" testId="pnl-total">
          {signed(report.totals.realizedPnlPaise)}
        </Stat>
        <Stat label="Turnover (buys + sells)">{formatPaise(report.totals.turnoverPaise)}</Stat>
        <Stat label="Trades">{report.totals.trades}</Stat>
        <Stat label="Charges">{formatPaise(report.totals.chargesPaise)}</Stat>
      </div>
      {report.rows.length === 0 ? (
        <div className="card empty-state muted">No trades in this period.</div>
      ) : (
        <div className="card table-card">
          <table className="table" data-testid="pnl-table">
            <thead>
              <tr>
                <th>Stock</th>
                <th className="num">Bought</th>
                <th className="num hide-sm">Avg buy</th>
                <th className="num">Sold</th>
                <th className="num hide-sm">Avg sell</th>
                <th className="num">Realised P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.symbol} data-testid={`pnl-row-${r.symbol}`}>
                  <td>
                    <div className="strong">{r.name}</div>
                    <div className="muted small">
                      {r.symbol} · {r.trades} trade{r.trades === 1 ? '' : 's'}
                    </div>
                  </td>
                  <td className="num">{r.buyQty}</td>
                  <td className="num hide-sm">{r.avgBuyPaise === null ? '—' : formatPaise(Math.round(r.avgBuyPaise))}</td>
                  <td className="num">{r.sellQty}</td>
                  <td className="num hide-sm">{r.avgSellPaise === null ? '—' : formatPaise(Math.round(r.avgSellPaise))}</td>
                  <td className="num strong" data-testid="pnl-row-realized">
                    {r.sellQty ? signed(r.realizedPnlPaise) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Realised P&amp;L uses the average-cost method. Charges are zero in paper trading.</p>
    </>
  );
}

function TradesView({ book }: { book: TradeBook }) {
  const days = [...new Set(book.trades.map((t) => istDateOf(t.createdAt)))];
  if (book.trades.length === 0) return <div className="card empty-state muted">No trades in this period.</div>;
  return (
    <>
      <div className="card table-card">
        <table className="table" data-testid="trades-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Stock</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th className="num hide-sm">Value</th>
              <th className="num">Realised</th>
            </tr>
          </thead>
          <tbody>
            {book.trades.map((t) => (
              <tr key={t.id} data-testid="trade-row">
                <td className="muted small">{formatTime(Date.parse(t.createdAt))}</td>
                <td>
                  <span className={`badge ${t.side === 'BUY' ? 'buy' : 'sell'}`}>{t.side}</span> <span className="strong">{t.symbol}</span>
                </td>
                <td className="num">{t.qty}</td>
                <td className="num">{formatPaise(t.pricePaise)}</td>
                <td className="num hide-sm">{formatPaise(t.valuePaise)}</td>
                <td className="num">{t.realizedPnlPaise === null ? '—' : signed(t.realizedPnlPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card contract-notes" data-testid="contract-note-links">
        <h3>Contract notes</h3>
        <div className="chip-group">
          {days.map((d) => (
            <Link key={d} to={`/reports/contract-note/${d}`} className="chip" data-testid={`contract-note-${d}`}>
              {new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

function StatementView({ statement }: { statement: Statement }) {
  return (
    <>
      <div className="report-stats">
        <Stat label="Opening balance">{formatPaise(statement.openingBalancePaise)}</Stat>
        <Stat label="Money in">{formatPaise(statement.creditsPaise)}</Stat>
        <Stat label="Money out">{formatPaise(statement.debitsPaise)}</Stat>
        <Stat label="Closing balance" testId="statement-closing">
          {formatPaise(statement.closingBalancePaise)}
        </Stat>
      </div>
      {statement.items.length === 0 ? (
        <div className="card empty-state muted">No cash movements in this period.</div>
      ) : (
        <div className="card table-card">
          <table className="table" data-testid="statement-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Description</th>
                <th className="num">Amount</th>
                <th className="num hide-sm">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.items.map((i) => (
                <tr key={i.id} data-testid="statement-row">
                  <td className="muted small">{formatTime(Date.parse(i.createdAt))}</td>
                  <td>{i.description}</td>
                  <td className="num">{signed(i.amountPaise)}</td>
                  <td className="num hide-sm">{formatPaise(i.balanceAfterPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
