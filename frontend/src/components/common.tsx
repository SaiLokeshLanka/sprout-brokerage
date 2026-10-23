import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { changeOf, useInstrument, useMarket, useQuote } from '../market/MarketContext';
import { formatChange, formatINR } from '../utils/format';

export function BrandLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="var(--primary)" />
      <path d="M16 25V14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 17c0-4.5 3-7 8-7 0 4.5-3 7-8 7Z" fill="#fff" />
      <path d="M16 20c0-3.6-2.4-5.6-6.4-5.6 0 3.6 2.4 5.6 6.4 5.6Z" fill="#fff" opacity="0.85" />
    </svg>
  );
}

export function FullPageLoader() {
  return (
    <div className="full-loader" role="status" aria-label="Loading" data-testid="app-loading">
      <BrandLogo size={48} />
    </div>
  );
}

const LOGO_COLORS = ['#0f4c81', '#1d4ed8', '#b02a30', '#7c3aed', '#0b6e4f', '#c2410c', '#be185d', '#0e7490', '#4d7c0f', '#7a4b1e'];

/** Stable badge colour per symbol, so new instruments from the database get one automatically. */
function logoColor(symbol: string) {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LOGO_COLORS[h % LOGO_COLORS.length];
}

export function StockLogo({ symbol, size = 40 }: { symbol: string; size?: number }) {
  return (
    <span
      className="stock-logo"
      style={{ width: size, height: size, background: logoColor(symbol), fontSize: size * 0.34 }}
      aria-hidden="true"
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

export function Change({ abs, pct, testId }: { abs: number; pct: number; testId?: string }) {
  return (
    <span className={abs >= 0 ? 'up' : 'down'} data-testid={testId}>
      {formatChange(abs, pct)}
    </span>
  );
}

export function StockCard({ symbol }: { symbol: string }) {
  const q = useQuote(symbol);
  const inst = useInstrument(symbol);
  if (!q || !inst) return null;
  const { abs, pct } = changeOf(q);
  return (
    <Link to={`/stocks/${symbol}`} className="card stock-card" data-testid={`stock-card-${symbol}`}>
      <StockLogo symbol={symbol} />
      <div className="stock-card-name">{inst.name}</div>
      <div className="stock-card-price" data-testid="ltp">
        {formatINR(q.ltp)}
      </div>
      <Change abs={abs} pct={pct} />
    </Link>
  );
}

/** Small "● Market open" pill. */
export function MarketStatusPill() {
  const { status } = useMarket();
  if (!status) return null;
  // Closed matters more than paused (pausing only freezes prices for tests).
  const label = !status.open ? 'Market closed' : status.paused ? 'Market paused' : 'Market open';
  return (
    <span
      className={`market-pill ${status.open && !status.paused ? 'open' : 'closed'}`}
      title={status.reason}
      data-testid="market-status"
      data-open={status.open && !status.paused}
    >
      <span className="dot" aria-hidden="true" />
      {label}
      <span className="muted small hide-sm"> · {status.reason}</span>
    </span>
  );
}

/** Thin banner shown while the live-price stream is down. */
export function ConnectionBanner() {
  const { connection } = useMarket();
  if (connection === 'live') return null;
  return (
    <div className="connection-banner" role="status" data-testid="connection-banner">
      {connection === 'connecting' ? 'Connecting to live prices…' : 'Live prices disconnected — reconnecting…'}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        <BrandLogo size={48} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
