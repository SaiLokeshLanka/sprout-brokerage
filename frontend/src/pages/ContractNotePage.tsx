import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { BrandLogo } from '../components/common';
import { formatPaise } from '../utils/format';

interface ContractNote {
  noteNumber: string;
  tradeDate: string;
  client: { name: string; email: string; panMasked: string | null };
  trades: {
    tradeId: string;
    orderId: string;
    time: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: string;
    product: string;
    qty: number;
    name: string | null;
    pricePaise: number;
    valuePaise: number;
    chargesPaise: number;
  }[];
  charges: Charges;
  totals: { buyValuePaise: number; sellValuePaise: number; chargesPaise: number; netPaise: number };
}

interface Charges {
  brokeragePaise: number;
  sttPaise: number;
  exchangePaise: number;
  sebiPaise: number;
  stampDutyPaise: number;
  gstPaise: number;
  totalPaise: number;
}

const CHARGE_ROWS: [keyof Charges, string][] = [
  ['brokeragePaise', 'Brokerage'],
  ['sttPaise', 'Securities Transaction Tax (STT)'],
  ['exchangePaise', 'Exchange transaction charges'],
  ['sebiPaise', 'SEBI turnover fee'],
  ['stampDutyPaise', 'Stamp duty'],
  ['gstPaise', 'GST (18% on brokerage + exchange + SEBI)'],
];

/** One day's trades in a printable layout. "Print / Save as PDF" uses the browser's print dialog. */
export function ContractNotePage() {
  const { date = '' } = useParams();
  const [note, setNote] = useState<ContractNote | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<ContractNote>(`/reports/contract-note?date=${date}`)
      .then(setNote)
      .catch((err) => setError(errorMessage(err)));
  }, [date]);

  if (error) return <div className="order-result err">{error}</div>;
  if (!note) return <div className="card empty-state muted">Loading…</div>;

  const prettyDate = new Date(`${note.tradeDate}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="page-single narrow contract-note-page">
      <div className="no-print section-head">
        <Link to="/reports?tab=trades" className="link">
          ← Back to reports
        </Link>
        <button className="btn-primary inline" onClick={() => window.print()} data-testid="print-note">
          Print / Save as PDF
        </button>
      </div>

      <article className="card contract-note" data-testid="contract-note">
        <header className="cn-header">
          <div className="brand">
            <BrandLogo size={28} />
            <span>Sprout</span>
          </div>
          <div className="cn-title">
            <h2>Contract note</h2>
            <div className="muted small">Paper trading — virtual money, not a legal document</div>
          </div>
        </header>

        <div className="kv-grid cn-meta">
          <div>
            <div className="muted small">Note number</div>
            <div className="strong" data-testid="cn-number">
              {note.noteNumber}
            </div>
          </div>
          <div>
            <div className="muted small">Trade date</div>
            <div className="strong">{prettyDate}</div>
          </div>
          <div>
            <div className="muted small">Client</div>
            <div className="strong">{note.client.name}</div>
            <div className="muted small">{note.client.email}</div>
          </div>
          <div>
            <div className="muted small">PAN</div>
            <div className="strong">{note.client.panMasked ?? 'Not provided'}</div>
          </div>
        </div>

        {note.trades.length === 0 ? (
          <p className="muted" data-testid="cn-empty">
            No trades on this date.
          </p>
        ) : (
          <table className="table cn-table" data-testid="cn-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Order</th>
                <th>Security</th>
                <th>Buy/Sell</th>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {note.trades.map((t) => (
                <tr key={t.tradeId} data-testid="cn-row">
                  <td>{new Date(t.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                  <td className="small">{t.orderId.slice(0, 8).toUpperCase()}</td>
                  <td>
                    {t.name ?? t.symbol}{' '}
                    <span className="muted small">NSE · {t.name ? 'NFO' : t.product === 'DELIVERY' ? 'CNC' : 'MIS'}</span>
                  </td>
                  <td>{t.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                  <td className="num">{t.qty}</td>
                  <td className="num">{formatPaise(t.pricePaise)}</td>
                  <td className="num">{formatPaise(t.valuePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="cn-totals">
          <div>
            <span>Total buy value</span>
            <span>{formatPaise(note.totals.buyValuePaise)}</span>
          </div>
          <div>
            <span>Total sell value</span>
            <span>{formatPaise(note.totals.sellValuePaise)}</span>
          </div>
          {CHARGE_ROWS.map(([key, label]) => (
            <div key={key} className="cn-charge" data-testid={`cn-${key.replace('Paise', '')}`}>
              <span>{label}</span>
              <span>{formatPaise(note.charges[key])}</span>
            </div>
          ))}
          <div data-testid="cn-charges">
            <span>Total charges</span>
            <span>{formatPaise(note.totals.chargesPaise)}</span>
          </div>
          <div className="strong" data-testid="cn-net">
            <span>{note.totals.netPaise >= 0 ? 'Net amount receivable' : 'Net amount payable'}</span>
            <span>{formatPaise(Math.abs(note.totals.netPaise))}</span>
          </div>
        </div>
      </article>
    </div>
  );
}
