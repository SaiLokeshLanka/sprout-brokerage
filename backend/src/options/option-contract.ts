/**
 * Index option contracts: symbols, lot sizes, strikes and expiry dates.
 *
 * A contract symbol is UNDERLYING + YYMMDD (expiry) + STRIKE (rupees) + CE/PE,
 * e.g. NIFTY26102724500CE = NIFTY call, strike ₹24,500, expiring 27 Oct 2026.
 * Contracts are generated on the fly, not stored in the instruments table.
 */

export type OptionKind = 'CE' | 'PE';

export interface UnderlyingConfig {
  symbol: string;
  name: string;
  /** Units per lot: orders must be a multiple of this. (Illustrative; NSE revises lot sizes.) */
  lotSize: number;
  strikeStepPaise: number;
  /** Base implied volatility for at-the-money options (yearly, 0.13 = 13%). */
  baseIv: number;
  expiry: 'weekly' | 'monthly';
}

export const UNDERLYINGS: Record<string, UnderlyingConfig> = {
  NIFTY: { symbol: 'NIFTY', name: 'NIFTY 50', lotSize: 75, strikeStepPaise: 5_000, baseIv: 0.13, expiry: 'weekly' },
  BANKNIFTY: { symbol: 'BANKNIFTY', name: 'NIFTY BANK', lotSize: 35, strikeStepPaise: 10_000, baseIv: 0.15, expiry: 'monthly' },
};

/** Strikes shown on each side of the at-the-money strike in the chain. */
export const CHAIN_STRIKES_EACH_SIDE = 15;
/** New positions may be opened this many strikes away from the current price at most. */
export const MAX_STRIKES_FROM_SPOT = 20;
const EXPIRY_DAY = 2; // Tuesday (NSE moved index expiries to Tuesday in 2025)
const WEEKLY_EXPIRIES = 4;
const MONTHLY_EXPIRIES = 3;

export interface OptionContract {
  symbol: string;
  underlying: string;
  /** YYYY-MM-DD */
  expiry: string;
  strikePaise: number;
  kind: OptionKind;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function optionSymbol(underlying: string, expiry: string, strikePaise: number, kind: OptionKind) {
  return `${underlying}${expiry.slice(2).replace(/-/g, '')}${strikePaise / 100}${kind}`;
}

/** Parses a contract symbol; null if it isn't one (e.g. an equity like RELIANCE). */
export function parseOptionSymbol(symbol: string): OptionContract | null {
  const m = /^([A-Z]+)(\d{2})(\d{2})(\d{2})(\d+)(CE|PE)$/.exec(symbol);
  if (!m || !UNDERLYINGS[m[1]]) return null;
  const expiry = `20${m[2]}-${m[3]}-${m[4]}`;
  if (Number.isNaN(Date.parse(`${expiry}T00:00:00Z`))) return null;
  return { symbol, underlying: m[1], expiry, strikePaise: Number(m[5]) * 100, kind: m[6] as OptionKind };
}

export const isOptionSymbol = (symbol: string) => parseOptionSymbol(symbol) !== null;

/** "NIFTY 27 Oct 24500 CE" */
export function optionDisplayName(c: OptionContract) {
  const [, month, day] = c.expiry.split('-').map(Number);
  return `${c.underlying} ${day} ${MONTHS[month - 1]} ${c.strikePaise / 100} ${c.kind}`;
}

/** Contracts stop trading at 3:30 PM IST on expiry day. */
export const expiryInstant = (expiry: string) => new Date(`${expiry}T15:30:00+05:30`);

export const isExpired = (c: Pick<OptionContract, 'expiry'>, now = new Date()) => now >= expiryInstant(c.expiry);

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Upcoming expiry dates: the next 4 Tuesdays (weekly) or the last Tuesday of the next 3 months (monthly). */
export function listExpiries(underlying: UnderlyingConfig, now = new Date()): string[] {
  const istToday = new Date(`${new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)}T00:00:00Z`);
  const out: string[] = [];
  if (underlying.expiry === 'weekly') {
    const d = new Date(istToday);
    d.setUTCDate(d.getUTCDate() + ((EXPIRY_DAY - d.getUTCDay() + 7) % 7));
    while (out.length < WEEKLY_EXPIRIES) {
      if (!isExpired({ expiry: isoDate(d) }, now)) out.push(isoDate(d));
      d.setUTCDate(d.getUTCDate() + 7);
    }
  } else {
    for (let m = 0; out.length < MONTHLY_EXPIRIES; m++) {
      const last = new Date(Date.UTC(istToday.getUTCFullYear(), istToday.getUTCMonth() + m + 1, 0)); // last day of month
      last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - EXPIRY_DAY + 7) % 7));
      if (!isExpired({ expiry: isoDate(last) }, now)) out.push(isoDate(last));
    }
  }
  return out;
}

/** Strike nearest to the price. */
export const atmStrike = (spotPaise: number, step: number) => Math.round(spotPaise / step) * step;
