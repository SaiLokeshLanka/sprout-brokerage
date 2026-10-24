import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Change, EmptyState, MarketStatusPill } from '../components/common';
import { OrderPanel } from '../components/OrderPanel';
import { changeOf, useQuote } from '../market/MarketContext';
import { formatChange, formatINR, formatInt, formatPaise } from '../utils/format';
import { formatExpiry } from '../utils/options';

interface OptionQuote {
  symbol: string;
  name: string;
  kind: 'CE' | 'PE';
  strikePaise: number;
  lotSize: number;
  ltpPaise: number;
  prevClosePaise: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  oi: number;
  volume: number;
}

interface Chain {
  underlying: string;
  name: string;
  spotPaise: number;
  expiry: string;
  expiries: string[];
  lotSize: number;
  atmStrikePaise: number;
  daysToExpiry: number;
  pcr: number | null;
  rows: { strikePaise: number; call: OptionQuote; put: OptionQuote }[];
}

export interface OptionPosition {
  symbol: string;
  name: string;
  qty: number;
  lotSize: number | null;
  avgPricePaise: number;
  investedPaise: number;
  ltpPaise: number;
  currentValuePaise: number;
  pnlPaise: number;
  pnlPct: number;
  dayPnlPaise: number;
  underlying: string;
  expiry: string;
  delta: number | null;
  theta: number | null;
  expired: boolean;
}

const UNDERLYINGS = ['NIFTY', 'BANKNIFTY'];
const POLL_MS = 2_000;
const pctChange = (q: OptionQuote) => (q.prevClosePaise ? ((q.ltpPaise - q.prevClosePaise) / q.prevClosePaise) * 100 : 0);
const lakh = (n: number) => (n >= 1e5 ? `${(n / 1e5).toFixed(2)}L` : formatInt(n));

/**
 * Polls a server URL every 2 seconds while the tab is visible. The result is tagged with the
 * URL it came from, so switching underlying or expiry never shows the old chain under the new name.
 */
function usePolled<T>(path: string | null) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      api
        .get<T>(path)
        .then((data) => !cancelled && setResult({ path, data }))
        .catch((err) => !cancelled && setResult({ path, error: errorMessage(err) }));
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [path]);
  return result?.path === path ? result : null;
}

/** Option positions with live premiums (the server prices them from the index). */
export function useOptionPositions() {
  return usePolled<OptionPosition[]>('/portfolio/options');
}

export function OptionsPage() {
  const [params, setParams] = useSearchParams();
  const underlying = UNDERLYINGS.includes(params.get('underlying') ?? '') ? params.get('underlying')! : 'NIFTY';
  const expiryParam = params.get('expiry');
  const chainResult = usePolled<Chain>(`/options/chain?underlying=${underlying}${expiryParam ? `&expiry=${expiryParam}` : ''}`);
  const positions = useOptionPositions();
  const spot = useQuote(underlying);
  const [selected, setSelected] = useState<string | null>(params.get('symbol'));

  const chain = chainResult?.data;
  const select = (symbol: string) => {
    setSelected(symbol);
    setParams((p) => {
      p.set('symbol', symbol);
      return p;
    });
  };
  const change = (next: Record<string, string | null>) => {
    setSelected(null);
    setParams(Object.fromEntries(Object.entries({ underlying, expiry: expiryParam, ...next, symbol: null }).filter(([, v]) => v)) as Record<string, string>);
  };

  const all = chain?.rows.flatMap((r) => [r.call, r.put]) ?? [];
  const contract = all.find((q) => q.symbol === selected) ?? null;
  const held = positions?.data?.find((p) => p.symbol === selected)?.qty ?? 0;
  const spotRupees = spot?.ltp ?? (chain ? chain.spotPaise / 100 : 0);

  return (
    <div className="page-grid">
      <div className="page-main">
        <section className="stock-header">
          <div className="section-head">
            <h1 className="page-title">Options chain</h1>
            <MarketStatusPill />
          </div>
          <div className="pill-tabs" role="tablist" aria-label="Underlying">
            {UNDERLYINGS.map((u) => (
              <button
                key={u}
                role="tab"
                aria-selected={u === underlying}
                className={`pill ${u === underlying ? 'active' : ''}`}
                onClick={() => change({ underlying: u, expiry: null })}
                data-testid={`underlying-${u}`}
              >
                {u}
              </button>
            ))}
          </div>
          {spot && (
            <div className="chain-spot">
              <span className="stock-price" data-testid="chain-spot">
                {formatINR(spot.ltp)}
              </span>{' '}
              <Change {...changeOf(spot)} />
            </div>
          )}
        </section>

        {!chain && !chainResult?.error && (
          <div className="card empty-state muted" data-testid="chain-loading">
            Loading option chain…
          </div>
        )}
        {chainResult?.error && (
          <div className="card order-result err" data-testid="chain-error">
            {chainResult.error}
          </div>
        )}

        {chain && (
          <>
            <div className="chain-bar card">
              <label className="field inline">
                <span>Expiry</span>
                <select value={chain.expiry} onChange={(e) => change({ expiry: e.target.value })} data-testid="expiry-select">
                  {chain.expiries.map((d) => (
                    <option key={d} value={d}>
                      {formatExpiry(d)} {d.slice(0, 4)}
                    </option>
                  ))}
                </select>
              </label>
              <Info label="Days to expiry" value={chain.daysToExpiry.toFixed(1)} testId="chain-days" />
              <Info label="Lot size" value={formatInt(chain.lotSize)} testId="chain-lot" />
              <Info label="PCR (OI)" value={chain.pcr?.toFixed(2) ?? '—'} testId="chain-pcr" />
            </div>

            <div className="card table-card chain-card">
              <table className="table chain" data-testid="option-chain">
                <thead>
                  <tr>
                    <th colSpan={5} className="center calls-head">
                      CALLS
                    </th>
                    <th className="center">Strike</th>
                    <th colSpan={5} className="center puts-head">
                      PUTS
                    </th>
                  </tr>
                  <tr>
                    <th className="num hide-sm">OI</th>
                    <th className="num hide-sm">Volume</th>
                    <th className="num hide-md">IV</th>
                    <th className="num hide-md">Delta</th>
                    <th className="num">LTP</th>
                    <th className="center">₹</th>
                    <th className="num">LTP</th>
                    <th className="num hide-md">Delta</th>
                    <th className="num hide-md">IV</th>
                    <th className="num hide-sm">Volume</th>
                    <th className="num hide-sm">OI</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.rows.map((r, i) => {
                    const strike = r.strikePaise / 100;
                    const next = chain.rows[i + 1]?.strikePaise / 100;
                    const callItm = strike < spotRupees;
                    const putItm = strike > spotRupees;
                    return [
                      <tr key={r.strikePaise} data-testid={`strike-${strike}`} className={r.strikePaise === chain.atmStrikePaise ? 'atm' : ''}>
                        <td className={`num hide-sm ${callItm ? 'itm' : ''}`}>{lakh(r.call.oi)}</td>
                        <td className={`num hide-sm ${callItm ? 'itm' : ''}`}>{lakh(r.call.volume)}</td>
                        <td className={`num hide-md ${callItm ? 'itm' : ''}`}>{r.call.iv.toFixed(1)}</td>
                        <td className={`num hide-md ${callItm ? 'itm' : ''}`}>{r.call.delta.toFixed(2)}</td>
                        <LtpCell q={r.call} itm={callItm} selected={selected === r.call.symbol} onSelect={select} />
                        <td className="center strong strike">{formatInt(strike)}</td>
                        <LtpCell q={r.put} itm={putItm} selected={selected === r.put.symbol} onSelect={select} />
                        <td className={`num hide-md ${putItm ? 'itm' : ''}`}>{r.put.delta.toFixed(2)}</td>
                        <td className={`num hide-md ${putItm ? 'itm' : ''}`}>{r.put.iv.toFixed(1)}</td>
                        <td className={`num hide-sm ${putItm ? 'itm' : ''}`}>{lakh(r.put.volume)}</td>
                        <td className={`num hide-sm ${putItm ? 'itm' : ''}`}>{lakh(r.put.oi)}</td>
                      </tr>,
                      // A marker line where the index price sits between two strikes.
                      strike <= spotRupees && next > spotRupees ? (
                        <tr key="spot" className="spot-row" data-testid="spot-row">
                          <td colSpan={11} className="center small">
                            {chain.underlying} {formatINR(spotRupees)}
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Shaded cells are in the money. Premiums are calculated from the simulated index price with the Black-Scholes formula
              (volatility around {chain.rows[15]?.call.iv.toFixed(0)}%); open interest and volume are simulated. Click a price to trade.
            </p>
          </>
        )}

        <OptionPositions title="Your option positions" showEmpty />
      </div>

      <aside className="page-aside sticky">
        {contract ? (
          <>
            <OrderPanel symbol={contract.symbol} ltp={contract.ltpPaise / 100} title={contract.name} lotSize={contract.lotSize} heldQty={held} stock={false} />
            <div className="card greeks" data-testid="greeks">
              <h3>Greeks</h3>
              <div className="stats-grid">
                <Info label="Delta" value={contract.delta.toFixed(3)} testId="greek-delta" hint="Premium change for a ₹1 move in the index" />
                <Info label="Gamma" value={contract.gamma.toFixed(5)} testId="greek-gamma" hint="How fast delta changes" />
                <Info label="Theta" value={contract.theta.toFixed(2)} testId="greek-theta" hint="Premium lost per day as expiry nears" />
                <Info label="Vega" value={contract.vega.toFixed(2)} testId="greek-vega" hint="Premium change for 1% more volatility" />
                <Info label="IV" value={`${contract.iv.toFixed(2)}%`} testId="greek-iv" hint="Implied volatility" />
                <Info label="1 lot costs" value={formatPaise(contract.ltpPaise * contract.lotSize)} testId="lot-cost" hint="Premium × lot size" />
              </div>
            </div>
          </>
        ) : (
          <div className="card note" data-testid="options-help">
            <div className="strong">How options work</div>
            <ul className="muted small help-list">
              <li>
                A <b>Call (CE)</b> gains when the index goes <b>up</b>; a <b>Put (PE)</b> gains when it goes <b>down</b>.
              </li>
              <li>You pay the premium × lot size. That is the most you can lose when buying.</li>
              <li>At expiry (3:30 PM on the expiry Tuesday) positions are settled in cash at their intrinsic value.</li>
              <li>Selling is allowed only to close a position you bought.</li>
            </ul>
            <div className="muted small">Click any premium in the chain to open the order ticket.</div>
          </div>
        )}
      </aside>
    </div>
  );
}

function LtpCell({ q, itm, selected, onSelect }: { q: OptionQuote; itm: boolean; selected: boolean; onSelect: (s: string) => void }) {
  const pct = pctChange(q);
  return (
    <td className={`num ltp-cell ${itm ? 'itm' : ''} ${selected ? 'selected' : ''}`}>
      <button type="button" className="btn-text plain" onClick={() => onSelect(q.symbol)} data-testid={`ltp-${q.symbol}`} aria-label={`Trade ${q.name}`}>
        <span className="strong">{formatPaise(q.ltpPaise)}</span>
        <span className={`small ${pct >= 0 ? 'up' : 'down'}`}>{`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}</span>
      </button>
    </td>
  );
}

function Info({ label, value, testId, hint }: { label: string; value: string; testId?: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="muted small">{label}</div>
      <div className="strong" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

/** Live option positions. Used on this page and on Investments. */
export function OptionPositions({ title, showEmpty = false }: { title: string; showEmpty?: boolean }) {
  const result = useOptionPositions();
  const rows = result?.data ?? [];
  if (!rows.length) {
    if (showEmpty && result?.data) {
      return (
        <section>
          <h2 className="section-title">{title}</h2>
          <div className="card">
            <EmptyState title="No open positions" text="Options you buy appear here with live premiums." />
          </div>
        </section>
      );
    }
    return null;
  }
  const total = rows.reduce((s, r) => s + r.pnlPaise, 0);
  return (
    <section data-testid="option-positions">
      <div className="section-head">
        <h2 className="section-title">
          {title} ({rows.length})
        </h2>
        <span className={`strong ${total >= 0 ? 'up' : 'down'}`} data-testid="option-positions-pnl">
          {total >= 0 ? '+' : ''}
          {formatPaise(total)}
        </span>
      </div>
      <div className="card table-card">
        <table className="table" data-testid="option-positions-table">
          <thead>
            <tr>
              <th>Contract</th>
              <th className="num">Qty</th>
              <th className="num hide-sm">Avg.</th>
              <th className="num">LTP</th>
              <th className="num">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.symbol} data-testid={`position-${p.symbol}`}>
                <td>
                  <Link to={`/options?underlying=${p.underlying}&expiry=${p.expiry}&symbol=${p.symbol}`} className="strong plain">
                    {p.name}
                  </Link>
                  <div className="muted small">{p.expired ? 'Expired — settling' : `Expires ${formatExpiry(p.expiry)}, 3:30 PM`}</div>
                </td>
                <td className="num" data-testid="position-qty">
                  {p.qty}
                  {p.lotSize && <div className="muted small">{p.qty / p.lotSize} lot</div>}
                </td>
                <td className="num hide-sm">{formatPaise(p.avgPricePaise)}</td>
                <td className="num">{formatPaise(p.ltpPaise)}</td>
                <td className={`num strong ${p.pnlPaise >= 0 ? 'up' : 'down'}`} data-testid="position-pnl">
                  {formatChange(p.pnlPaise / 100, p.pnlPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
