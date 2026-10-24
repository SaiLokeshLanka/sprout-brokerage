/**
 * Black-Scholes option pricing — the standard formula for the fair price of a
 * European option (Indian index options are European: they can only be settled at expiry).
 *
 * Inputs: spot S and strike K (same unit), years to expiry T, risk-free rate r, volatility sigma.
 */

export interface Greeks {
  price: number;
  /** Change in option price for a 1-unit move in the underlying. Calls 0…1, puts −1…0. */
  delta: number;
  /** Change in delta for a 1-unit move in the underlying. */
  gamma: number;
  /** Change in option price per calendar day that passes (usually negative). */
  theta: number;
  /** Change in option price for a 1 percentage-point change in volatility. */
  vega: number;
}

/** Standard normal cumulative distribution (Abramowitz & Stegun 26.2.17, error < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = normPdf(x) * poly;
  return x >= 0 ? 1 - tail : tail;
}

export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

export function blackScholes(kind: 'CE' | 'PE', S: number, K: number, T: number, r: number, sigma: number): Greeks {
  if (T <= 0 || sigma <= 0) {
    // At (or after) expiry an option is worth only its intrinsic value.
    const itm = kind === 'CE' ? S > K : S < K;
    return { price: Math.max(0, kind === 'CE' ? S - K : K - S), delta: itm ? (kind === 'CE' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const discount = Math.exp(-r * T);
  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const vega = (S * normPdf(d1) * sqrtT) / 100;
  const decay = -(S * normPdf(d1) * sigma) / (2 * sqrtT);

  if (kind === 'CE') {
    return {
      price: S * normCdf(d1) - K * discount * normCdf(d2),
      delta: normCdf(d1),
      gamma,
      theta: (decay - r * K * discount * normCdf(d2)) / 365,
      vega,
    };
  }
  return {
    price: K * discount * normCdf(-d2) - S * normCdf(-d1),
    delta: normCdf(d1) - 1,
    gamma,
    theta: (decay + r * K * discount * normCdf(-d2)) / 365,
    vega,
  };
}
