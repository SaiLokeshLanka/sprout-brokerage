import { describe, expect, it } from 'vitest';
import { bollinger, ema, lastValue, macd, rsi, sma } from './indicators';

describe('sma', () => {
  it('averages the last N values and is null before that', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe('ema', () => {
  it('starts from the simple average, then weights recent prices by 2 / (N + 1)', () => {
    // seed = (1 + 2 + 3) / 3 = 2; next = 4 × 0.5 + 2 × 0.5 = 3; then 5 × 0.5 + 3 × 0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('skips leading nulls', () => {
    expect(ema([null, null, 2, 4, 6], 2)).toEqual([null, null, null, 3, 5]);
  });

  it('is all null when there is not enough data', () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });
});

describe('rsi', () => {
  // The worked example from Wilder's method as published by StockCharts.com (14 periods).
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];

  it('matches the published example', () => {
    const r = rsi(closes, 14);
    expect(r[13]).toBeNull();
    // Published: 70.53, 66.32, 57.97. The spreadsheet rounds each step to 2 decimals, so allow ±0.1.
    expect(Math.abs(r[14]! - 70.53)).toBeLessThan(0.1);
    expect(Math.abs(r[15]! - 66.32)).toBeLessThan(0.1);
    expect(Math.abs(r[19]! - 57.97)).toBeLessThan(0.1);
  });

  it('is 100 when prices only rise and 0 when they only fall', () => {
    const up = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(lastValue(rsi(up))).toBe(100);
    expect(lastValue(rsi([...up].reverse()))).toBe(0);
  });

  it('always stays between 0 and 100', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i) * 5 + (i % 7));
    for (const v of rsi(noisy)) if (v !== null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
  });
});

describe('macd', () => {
  it('is 0 for a flat price', () => {
    const flat = Array.from({ length: 60 }, () => 250);
    const m = macd(flat);
    expect(lastValue(m.macd)).toBe(0);
    expect(lastValue(m.signal)).toBe(0);
    expect(lastValue(m.histogram)).toBe(0);
  });

  it('is positive in an uptrend, and has values only after the slow EMA starts', () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macd(up);
    expect(m.macd[24]).toBeNull();
    expect(m.macd[25]).not.toBeNull();
    expect(m.signal[25 + 7]).toBeNull();
    expect(m.signal[25 + 8]).not.toBeNull();
    expect(lastValue(m.macd)!).toBeGreaterThan(0);
  });
});

describe('bollinger', () => {
  it('bands collapse onto the average for a flat price', () => {
    const b = bollinger(Array.from({ length: 25 }, () => 10));
    expect(lastValue(b.upper)).toBe(10);
    expect(lastValue(b.lower)).toBe(10);
  });

  it('middle is the SMA and the bands are 2 standard deviations away', () => {
    // 2, 4, 4, 4, 5, 5, 7, 9: mean 5, population standard deviation exactly 2
    const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(b.middle[7]).toBe(5);
    expect(b.upper[7]).toBe(9);
    expect(b.lower[7]).toBe(1);
  });
});
