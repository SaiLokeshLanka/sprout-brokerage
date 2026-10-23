const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** Paise → "₹1,23,456.78" (Indian digit grouping), for human-readable messages. */
export const inr = (paise: number | bigint) => inrFormat.format(Number(paise) / 100);

/** a / b rounded to the nearest whole number, for positive bigints. */
export const roundDiv = (a: bigint, b: bigint) => (a * 2n + b) / (2n * b);
