import { roundDiv } from '../common/money';

/**
 * Brokerage, taxes and fees on a trade, the way an Indian discount broker charges them.
 *
 * Rates are illustrative (close to published NSE / SEBI / government rates in 2025);
 * real rates change over time and differ between brokers. Change them only here.
 * Rates are "parts per crore" (1 crore = 1,00,00,000), so 0.1% = 10,000 and ₹10 per crore = 10.
 */

export type Segment = 'EQUITY_DELIVERY' | 'EQUITY_INTRADAY' | 'OPTIONS';

const PER_CRORE = 10_000_000n;

interface SegmentRates {
  /** Brokerage = min(flat cap, value × rate). Delivery is free at most discount brokers. */
  brokerageRate: bigint;
  brokerageCapPaise: bigint;
  /** Securities Transaction Tax, charged by the government. */
  sttBuyRate: bigint;
  sttSellRate: bigint;
  /** NSE transaction charge. */
  exchangeRate: bigint;
  /** Stamp duty (state government), on buys only. */
  stampBuyRate: bigint;
}

export const CHARGE_RATES: Record<Segment, SegmentRates> = {
  EQUITY_DELIVERY: { brokerageRate: 0n, brokerageCapPaise: 0n, sttBuyRate: 10_000n, sttSellRate: 10_000n, exchangeRate: 297n, stampBuyRate: 1_500n },
  EQUITY_INTRADAY: { brokerageRate: 3_000n, brokerageCapPaise: 2_000n, sttBuyRate: 0n, sttSellRate: 2_500n, exchangeRate: 297n, stampBuyRate: 300n },
  // Options: flat ₹20 per order; percentages apply to the premium paid or received.
  OPTIONS: { brokerageRate: PER_CRORE, brokerageCapPaise: 2_000n, sttBuyRate: 0n, sttSellRate: 10_000n, exchangeRate: 3_503n, stampBuyRate: 300n },
};
/** SEBI turnover fee: ₹10 per crore, every segment. */
export const SEBI_RATE = 10n;
/** GST on brokerage + exchange charge + SEBI fee. */
export const GST_PERCENT = 18n;

export interface ChargeBreakdown {
  brokeragePaise: number;
  sttPaise: number;
  exchangePaise: number;
  sebiPaise: number;
  stampDutyPaise: number;
  gstPaise: number;
  totalPaise: number;
}

export const NO_CHARGES: ChargeBreakdown = {
  brokeragePaise: 0,
  sttPaise: 0,
  exchangePaise: 0,
  sebiPaise: 0,
  stampDutyPaise: 0,
  gstPaise: 0,
  totalPaise: 0,
};

const ofValue = (value: bigint, rate: bigint) => roundDiv(value * rate, PER_CRORE);

/** Charges on one trade of `valuePaise` (price × quantity). Each part is rounded to the nearest paisa. */
export function computeCharges(segment: Segment, side: 'BUY' | 'SELL', valuePaise: bigint): ChargeBreakdown {
  if (valuePaise <= 0n) return NO_CHARGES;
  const r = CHARGE_RATES[segment];
  const brokerage = r.brokerageCapPaise === 0n ? 0n : [ofValue(valuePaise, r.brokerageRate), r.brokerageCapPaise].reduce((a, b) => (a < b ? a : b));
  const stt = ofValue(valuePaise, side === 'BUY' ? r.sttBuyRate : r.sttSellRate);
  const exchange = ofValue(valuePaise, r.exchangeRate);
  const sebi = ofValue(valuePaise, SEBI_RATE);
  const stamp = side === 'BUY' ? ofValue(valuePaise, r.stampBuyRate) : 0n;
  const gst = roundDiv((brokerage + exchange + sebi) * GST_PERCENT, 100n);
  const total = brokerage + stt + exchange + sebi + stamp + gst;
  return {
    brokeragePaise: Number(brokerage),
    sttPaise: Number(stt),
    exchangePaise: Number(exchange),
    sebiPaise: Number(sebi),
    stampDutyPaise: Number(stamp),
    gstPaise: Number(gst),
    totalPaise: Number(total),
  };
}

/** Adds up breakdowns (for contract notes and reports). */
export function sumCharges(list: Partial<ChargeBreakdown>[]): ChargeBreakdown {
  const out = { ...NO_CHARGES };
  for (const c of list) for (const k of Object.keys(out) as (keyof ChargeBreakdown)[]) out[k] += c[k] ?? 0;
  return out;
}
