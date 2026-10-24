/** Where the app under test runs. Override with environment variables (e.g. on a CI server). */
export const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';
export const API_URL = process.env.API_URL ?? 'http://localhost:3000/api';
