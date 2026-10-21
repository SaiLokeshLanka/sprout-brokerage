const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-IN');

export const formatINR = (rupees: number) => inr.format(rupees);
export const formatPaise = (paise: number) => inr.format(paise / 100);
export const formatNum = (n: number) => num.format(n);
export const formatInt = (n: number) => int.format(n);
export const formatPct = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
export const formatChange = (abs: number, pct: number) =>
  `${abs >= 0 ? '+' : ''}${num.format(abs)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;

/** Money is stored as integer paise to avoid floating-point drift. */
export const toPaise = (rupees: number) => Math.round(rupees * 100);

/** NSE equities trade in ₹0.05 ticks. */
export const roundToTick = (price: number, tick = 0.05) =>
  Math.round(Math.round(price / tick) * tick * 100) / 100;

export const formatTime = (ts: number) =>
  new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
