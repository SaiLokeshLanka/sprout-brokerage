/** Money helpers. The API uses integer paise (₹1 = 100 paise); the UI shows rupees. */

const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** Rupees → "₹1,00,000.00", exactly like the app formats money. */
export const inr = (rupees: number) => inrFormat.format(rupees);

/** Paise → "₹1,00,000.00". */
export const inrPaise = (paise: number) => inr(paise / 100);

/** Paise → "1234.50", for typing into a price box. */
export const rupeesText = (paise: number) => (paise / 100).toFixed(2);

/** Round paise to the ₹0.05 tick size. */
export const tick5 = (paise: number) => Math.round(paise / 5) * 5;

/**
 * Charges on a delivery (CNC) stock trade, in paise — the published rates, written out here
 * independently of the app, so tests check the app against the rules and not against itself.
 * STT 0.1% both sides, exchange 0.00297%, SEBI ₹10/crore, stamp duty 0.015% on buys,
 * GST 18% on (brokerage + exchange + SEBI). No brokerage on delivery. Each part rounded to the paisa.
 */
export function deliveryCharges(side: 'BUY' | 'SELL', valuePaise: number) {
  const part = (rate: number) => Math.round(valuePaise * rate);
  const stt = part(0.001);
  const exchange = part(0.0000297);
  const sebi = part(0.000001);
  const stamp = side === 'BUY' ? part(0.00015) : 0;
  const gst = Math.round((exchange + sebi) * 0.18);
  return stt + exchange + sebi + stamp + gst;
}
