/**
 * Market session rules. NSE equities trade Mon–Fri, 09:15–15:30 IST.
 *
 * MARKET_MODE=always  → simulated market never closes (default for development,
 *                       so prices move whenever you're working on the app)
 * MARKET_MODE=nse     → follow real NSE hours, weekends and holidays
 */

export type MarketMode = 'always' | 'nse';

export const NSE_OPEN_MINUTE = 9 * 60 + 15; // 09:15 IST
export const NSE_CLOSE_MINUTE = 15 * 60 + 30; // 15:30 IST
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/** Exchange holidays as YYYY-MM-DD (IST). Add dates from the official NSE holiday circular. */
export const NSE_HOLIDAYS = new Set<string>([]);

/** Calendar date, minute-of-day and weekday in India Standard Time, whatever the server's timezone. */
export function istParts(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    date: ist.toISOString().slice(0, 10),
    minuteOfDay: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    weekday: ist.getUTCDay(), // 0 = Sunday
  };
}

export function sessionState(mode: MarketMode, now = new Date()): { open: boolean; reason: string } {
  if (mode === 'always') return { open: true, reason: 'Simulated market — always open' };

  const { date, minuteOfDay, weekday } = istParts(now);
  if (weekday === 0 || weekday === 6) return { open: false, reason: 'Closed for the weekend' };
  if (NSE_HOLIDAYS.has(date)) return { open: false, reason: 'Closed for a market holiday' };
  if (minuteOfDay < NSE_OPEN_MINUTE) return { open: false, reason: 'Opens at 9:15 AM IST' };
  if (minuteOfDay >= NSE_CLOSE_MINUTE) return { open: false, reason: 'Closed at 3:30 PM IST' };
  return { open: true, reason: 'Open until 3:30 PM IST' };
}
