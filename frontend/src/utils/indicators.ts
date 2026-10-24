/**
 * Technical indicators, calculated from closing prices.
 * Every function returns one value per input price; `null` where there isn't enough
 * history yet (e.g. a 20-period average has no value for the first 19 prices).
 */

export type Series = (number | null)[];

/** Simple moving average: the plain average of the last `period` prices. */
export function sma(values: number[], period: number): Series {
  const out: Series = [];
  let sum = 0;
  values.forEach((v, i) => {
    sum += v;
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  });
  return out;
}

/**
 * Exponential moving average: recent prices count more. Starts from the simple average of
 * the first `period` values, then each step moves 2 / (period + 1) of the way to the new price.
 * Leading nulls in the input (e.g. MACD before it has a value) are skipped.
 */
export function ema(values: Series, period: number): Series {
  const out: Series = values.map(() => null);
  const k = 2 / (period + 1);
  const first = values.findIndex((v) => v !== null);
  if (first < 0 || values.length - first < period) return out;
  let prev = (values.slice(first, first + period) as number[]).reduce((s, v) => s + v, 0) / period;
  out[first + period - 1] = prev;
  for (let i = first + period; i < values.length; i++) {
    prev = (values[i] as number) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Relative Strength Index (Wilder, 1978): 0–100. Compares the average gain of up-moves with the
 * average loss of down-moves over `period` prices. Above 70 is often read as "overbought",
 * below 30 as "oversold".
 */
export function rsi(closes: number[], period = 14): Series {
  const out: Series = closes.map(() => null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    // Wilder's smoothing: like an EMA with k = 1 / period.
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

/**
 * MACD: fast EMA − slow EMA (12 and 26 by default). The signal line is a 9-period EMA of MACD,
 * and the histogram is MACD − signal. MACD crossing above its signal is read as momentum turning up.
 */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line: Series = closes.map((_, i) => (f[i] !== null && s[i] !== null ? (f[i] as number) - (s[i] as number) : null));
  const signal = ema(line, signalPeriod);
  const histogram: Series = line.map((m, i) => (m !== null && signal[i] !== null ? m - (signal[i] as number) : null));
  return { macd: line, signal, histogram };
}

/**
 * Bollinger Bands: a `period` simple average with bands `mult` standard deviations above and
 * below it. About 95% of prices fall inside the bands; touching a band means an unusual move.
 */
export function bollinger(closes: number[], period = 20, mult = 2) {
  const middle = sma(closes, period);
  const upper: Series = [];
  const lower: Series = [];
  closes.forEach((_, i) => {
    const m = middle[i];
    if (m === null) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const window = closes.slice(i - period + 1, i + 1);
    const sd = Math.sqrt(window.reduce((s, v) => s + (v - m) ** 2, 0) / period);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  });
  return { middle, upper, lower };
}

/** The last non-null value of a series (what the chart legend shows). */
export const lastValue = (s: Series) => {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] !== null) return s[i] as number;
  return null;
};
