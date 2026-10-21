import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { INDICES, STOCKS } from '../data/instruments';
import { roundToTick } from '../utils/format';
import { hashString, mulberry32 } from '../utils/random';

/**
 * Client-side market simulator. It stands in for the backend Market Data
 * Service + WebSocket feed until that exists; components only depend on
 * useMarket()/useQuote(), so swapping the source later is local to this file.
 */

export interface Quote {
  symbol: string;
  ltp: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

export type Quotes = Record<string, Quote>;

const TICK_MS = 1500;
const MAX_TICK_MOVE = 0.003; // ±0.15% per tick

function initialQuotes(): Quotes {
  const quotes: Quotes = {};
  for (const inst of [...STOCKS, ...INDICES]) {
    const rnd = mulberry32(hashString(inst.symbol + new Date().toDateString()));
    const prevClose = inst.basePrice;
    const open = roundToTick(prevClose * (1 + (rnd() - 0.5) * 0.01));
    const ltp = roundToTick(prevClose * (1 + (rnd() - 0.5) * 0.06));
    quotes[inst.symbol] = {
      symbol: inst.symbol,
      ltp,
      prevClose,
      open,
      high: roundToTick(Math.max(open, ltp) * (1 + rnd() * 0.005)),
      low: roundToTick(Math.min(open, ltp) * (1 - rnd() * 0.005)),
      volume: Math.floor(rnd() * 5_000_000) + 200_000,
    };
  }
  return quotes;
}

export function changeOf(q: Quote) {
  const abs = q.ltp - q.prevClose;
  return { abs, pct: (abs / q.prevClose) * 100 };
}

interface MarketContextValue {
  quotes: Quotes;
  paused: boolean;
}

const MarketContext = createContext<MarketContextValue | null>(null);

/** Test hooks so Playwright can make prices deterministic. */
export interface MarketTestHooks {
  setPrice: (symbol: string, price: number) => void;
  pause: () => void;
  resume: () => void;
  getQuote: (symbol: string) => Quote | undefined;
}

declare global {
  interface Window {
    __market?: MarketTestHooks;
  }
}

const TEST_HOOKS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_HOOKS === 'true';

export function MarketProvider({ children }: { children: ReactNode }) {
  const [quotes, setQuotes] = useState<Quotes>(initialQuotes);
  const [paused, setPaused] = useState(false);
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setQuotes((prev) => {
        const next: Quotes = {};
        for (const [symbol, q] of Object.entries(prev)) {
          const ltp = Math.max(0.05, roundToTick(q.ltp * (1 + (Math.random() - 0.5) * MAX_TICK_MOVE)));
          next[symbol] = {
            ...q,
            ltp,
            high: Math.max(q.high, ltp),
            low: Math.min(q.low, ltp),
            volume: q.volume + Math.floor(Math.random() * 5000),
          };
        }
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  useEffect(() => {
    if (!TEST_HOOKS_ENABLED) return;
    window.__market = {
      setPrice: (symbol, price) =>
        setQuotes((prev) => {
          const q = prev[symbol];
          if (!q) return prev;
          const ltp = roundToTick(price);
          return { ...prev, [symbol]: { ...q, ltp, high: Math.max(q.high, ltp), low: Math.min(q.low, ltp) } };
        }),
      pause: () => setPaused(true),
      resume: () => setPaused(false),
      getQuote: (symbol) => quotesRef.current[symbol],
    };
    return () => {
      delete window.__market;
    };
  }, []);

  return <MarketContext.Provider value={{ quotes, paused }}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be used inside <MarketProvider>');
  return ctx;
}

export function useQuote(symbol: string): Quote | undefined {
  return useMarket().quotes[symbol];
}
