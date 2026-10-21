import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { STOCK_MAP } from '../data/instruments';
import { changeOf, useQuote } from '../market/MarketContext';
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

export function StockLogo({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const inst = STOCK_MAP[symbol];
  return (
    <span
      className="stock-logo"
      style={{ width: size, height: size, background: inst?.color ?? '#888', fontSize: size * 0.34 }}
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
  const inst = STOCK_MAP[symbol];
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
