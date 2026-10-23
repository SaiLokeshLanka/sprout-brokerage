import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api/client';

/**
 * Market data from the backend:
 * - the instrument list from GET /api/instruments
 * - live prices over the Socket.IO stream ('snapshot', then 'ticks' every second)
 * - market session status ('status')
 *
 * The server sends integer paise; this context converts to rupees once, so the
 * rest of the UI keeps working with plain rupee numbers.
 */

export interface InstrumentInfo {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  type: 'EQUITY' | 'INDEX';
  sector: string | null;
  lotSize: number;
  tickSizePaise: number;
  peRatio: number | null;
  marketCapCr: number | null;
}

/** A quote in rupees. */
export interface Quote {
  symbol: string;
  ltp: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  upperCircuit: number | null;
  lowerCircuit: number | null;
  volume: number;
  updatedAt: number;
}

export type Quotes = Record<string, Quote>;

export interface MarketStatus {
  open: boolean;
  reason: string;
  mode: 'always' | 'nse';
  paused: boolean;
}

/** 'live' = streaming; 'connecting' = first connect; 'reconnecting' = lost and retrying. */
export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

interface ServerQuote {
  symbol: string;
  ltpPaise: number;
  prevClosePaise: number;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  upperCircuitPaise: number | null;
  lowerCircuitPaise: number | null;
  volume: number;
  updatedAt: number;
}

const rupees = (paise: number) => paise / 100;

function toQuote(q: ServerQuote): Quote {
  return {
    symbol: q.symbol,
    ltp: rupees(q.ltpPaise),
    prevClose: rupees(q.prevClosePaise),
    open: rupees(q.openPaise),
    high: rupees(q.highPaise),
    low: rupees(q.lowPaise),
    upperCircuit: q.upperCircuitPaise === null ? null : rupees(q.upperCircuitPaise),
    lowerCircuit: q.lowerCircuitPaise === null ? null : rupees(q.lowerCircuitPaise),
    volume: q.volume,
    updatedAt: q.updatedAt,
  };
}

function mergeQuotes(prev: Quotes, incoming: ServerQuote[]): Quotes {
  const next = { ...prev };
  for (const q of incoming) next[q.symbol] = toQuote(q);
  return next;
}

export function changeOf(q: Quote) {
  const abs = q.ltp - q.prevClose;
  return { abs, pct: q.prevClose ? (abs / q.prevClose) * 100 : 0 };
}

interface MarketContextValue {
  /** Instrument list load state. Pages need it before they can render. */
  loadState: 'loading' | 'ready' | 'error';
  retry: () => void;
  stocks: InstrumentInfo[];
  indices: InstrumentInfo[];
  bySymbol: Record<string, InstrumentInfo>;
  quotes: Quotes;
  status: MarketStatus | null;
  connection: ConnectionState;
}

const MarketContext = createContext<MarketContextValue | null>(null);

/** Headline indices first, in the order Indian investors expect; any others after. */
const INDEX_ORDER = ['NIFTY', 'SENSEX', 'BANKNIFTY'];
const indexRank = (symbol: string) => {
  const i = INDEX_ORDER.indexOf(symbol);
  return i === -1 ? INDEX_ORDER.length : i;
};

/** Dev-only helpers that call the server's test hooks (the market is shared, so these affect every client). */
export interface MarketTestHooks {
  pause: () => Promise<unknown>;
  resume: () => Promise<unknown>;
  setPrice: (symbol: string, price: number) => Promise<unknown>;
  setSession: (state: 'open' | 'closed' | 'auto') => Promise<unknown>;
}

declare global {
  interface Window {
    __market?: MarketTestHooks;
  }
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [instruments, setInstruments] = useState<InstrumentInfo[]>([]);
  const [quotes, setQuotes] = useState<Quotes>({});
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  // 1) The instrument list (names, sectors, fundamentals) — from the database.
  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    api
      .get<InstrumentInfo[]>('/instruments', { auth: false })
      .then((list) => {
        if (cancelled) return;
        setInstruments(list);
        setLoadState('ready');
      })
      .catch(() => !cancelled && setLoadState('error'));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // 2) Live prices — one WebSocket for the whole app. Socket.IO reconnects automatically.
  useEffect(() => {
    const socket = io({ transports: ['websocket'] });
    socket.on('connect', () => setConnection('live'));
    socket.on('disconnect', () => setConnection('reconnecting'));
    socket.on('connect_error', () => setConnection((c) => (c === 'connecting' ? 'connecting' : 'reconnecting')));
    socket.on('status', (s: MarketStatus) => setStatus(s));
    socket.on('snapshot', (list: ServerQuote[]) => setQuotes(mergeQuotes({}, list)));
    socket.on('ticks', (list: ServerQuote[]) => setQuotes((prev) => mergeQuotes(prev, list)));
    return () => {
      socket.close();
    };
  }, []);

  // 3) Test hooks in development, so Playwright can drive the shared market.
  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.VITE_ENABLE_TEST_HOOKS !== 'true') return;
    const post = (path: string, body?: unknown) => api.post(`/test/market/${path}`, body ?? {}, { auth: false });
    window.__market = {
      pause: () => post('pause'),
      resume: () => post('resume'),
      setPrice: (symbol, price) => post('price', { symbol, price }),
      setSession: (state) => post('session', { state }),
    };
    return () => {
      delete window.__market;
    };
  }, []);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const value = useMemo<MarketContextValue>(() => {
    const active = instruments.filter((i) => quotes[i.symbol]);
    return {
      loadState,
      retry,
      // Only list instruments that have a live quote, so pages never render a stock without a price.
      stocks: active.filter((i) => i.type === 'EQUITY'),
      indices: active.filter((i) => i.type === 'INDEX').sort((a, b) => indexRank(a.symbol) - indexRank(b.symbol)),
      bySymbol: Object.fromEntries(instruments.map((i) => [i.symbol, i])),
      quotes,
      status,
      connection,
    };
  }, [loadState, retry, instruments, quotes, status, connection]);

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be used inside <MarketProvider>');
  return ctx;
}

export function useQuote(symbol: string): Quote | undefined {
  return useMarket().quotes[symbol];
}

export function useInstrument(symbol: string): InstrumentInfo | undefined {
  return useMarket().bySymbol[symbol];
}
