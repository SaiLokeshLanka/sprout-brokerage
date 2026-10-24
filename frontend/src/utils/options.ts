/** Option contract symbols: UNDERLYING + YYMMDD + STRIKE + CE/PE, e.g. NIFTY26102724500CE. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface OptionContract {
  underlying: string;
  expiry: string;
  strike: number;
  kind: 'CE' | 'PE';
}

export function parseOptionSymbol(symbol: string): OptionContract | null {
  const m = /^(NIFTY|BANKNIFTY)(\d{2})(\d{2})(\d{2})(\d+)(CE|PE)$/.exec(symbol);
  if (!m) return null;
  return { underlying: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, strike: Number(m[5]), kind: m[6] as 'CE' | 'PE' };
}

/** "27 Oct" */
export function formatExpiry(expiry: string) {
  const [, month, day] = expiry.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/** "NIFTY 27 Oct 24500 CE", or null for a stock symbol. */
export function optionName(symbol: string) {
  const c = parseOptionSymbol(symbol);
  return c ? `${c.underlying} ${formatExpiry(c.expiry)} ${c.strike} ${c.kind}` : null;
}
