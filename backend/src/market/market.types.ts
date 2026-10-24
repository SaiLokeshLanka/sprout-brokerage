import type { MarketMode } from './market-clock';

/** Redis hash holding the latest quote for every symbol (field = symbol, value = JSON). */
export const QUOTES_KEY = 'market:quotes';
/** Redis pub/sub channel: a JSON array of quotes, published once per tick. */
export const TICKS_CHANNEL = 'market:ticks';
/** Redis pub/sub channel: market status changes (open/close/pause). */
export const STATUS_CHANNEL = 'market:status';

/** All prices are integer paise. */
export interface Quote {
  symbol: string;
  ltpPaise: number;
  prevClosePaise: number;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  /** Price band for the day (±10% of previous close). Null for indices. */
  upperCircuitPaise: number | null;
  lowerCircuitPaise: number | null;
  volume: number;
  updatedAt: number;
}

/** OHLC candle; t = unix seconds at the start of the period, vol = shares traded in it. */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number;
}

export interface MarketStatus {
  open: boolean;
  reason: string;
  mode: MarketMode;
  paused: boolean;
  serverTime: string;
}

export const CHART_RANGES = ['1D', '1W', '1M', '1Y', '5Y'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
