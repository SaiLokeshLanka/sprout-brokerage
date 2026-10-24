import { istParts } from '../market/market-clock';

/** Dates in reports are calendar days in India Standard Time, written YYYY-MM-DD. */

export const todayIst = () => istParts().date;

export const isValidDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The instant an IST day starts (midnight IST = 18:30 UTC the previous day). */
export const istDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

/** [start, end) covering whole IST days from `from` to `to` inclusive. */
export const istRange = (from: string, to: string) => ({
  start: istDayStart(from),
  end: new Date(istDayStart(to).getTime() + 86_400_000),
});

/** Indian financial year runs 1 April – 31 March. Returns the start date of the FY containing `date`. */
export function financialYearStart(date = todayIst()) {
  const [year, month] = date.split('-').map(Number);
  return `${month >= 4 ? year : year - 1}-04-01`;
}

/** Formats an instant as an IST date + time for CSVs: "2026-10-24 14:05:09". */
export function istDateTime(d: Date) {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
}
