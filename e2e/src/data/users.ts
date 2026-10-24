/** Test data for users. Every test gets its own unique user, so tests never affect each other. */

export interface UserData {
  fullName: string;
  email: string;
  password: string;
}

/** Created by `npm run db:seed`. Shared by everyone: only use it for read-only checks. */
export const DEMO_USER: UserData = { fullName: 'Demo User', email: 'demo@sprout.dev', password: 'Demo@1234' };

/** Welcome money every new account gets, in paise (₹1,00,000). */
export const WELCOME_BONUS_PAISE = 10_000_000;

let counter = 0;

/** A brand-new user that doesn't exist yet. Pass overrides to control any field. */
export function newUserData(overrides: Partial<UserData> = {}): UserData {
  const unique = `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { fullName: 'Playwright Trader', email: `pw.${unique}@example.com`, password: 'Secret123', ...overrides };
}

/** A valid-looking PAN that is unique per call (format: 5 letters, 4 digits, 1 letter). */
export function uniquePan() {
  const letters = () => Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  return `${letters()}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
}
