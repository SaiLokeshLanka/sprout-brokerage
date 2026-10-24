import { expect, test as setup } from '@playwright/test';
import { API_URL, WEB_URL } from '../../src/config';

/**
 * Runs once before all other projects (they list 'setup' in `dependencies`).
 * If the app isn't running, this fails with a clear message and nothing else runs.
 */
setup('the app is running and ready for tests', async ({ request }) => {
  const health = await request.get(`${API_URL}/health`).catch(() => null);
  expect(health?.ok(), `API is not reachable at ${API_URL}. Start it: npm run db:up, then npm run dev`).toBeTruthy();
  const status = await health!.json();
  expect(status.db, 'API is up but the database is down. Start Docker Desktop, then npm run db:up').toBe('up');
  expect(status.redis, 'API is up but Redis is down. Start Docker Desktop, then npm run db:up').toBe('up');

  const web = await request.get(WEB_URL).catch(() => null);
  expect(web?.ok(), `Web app is not reachable at ${WEB_URL}. Start it: npm run dev`).toBeTruthy();

  // Test hooks let tests set exact prices. They return 404 unless the API runs with ENABLE_TEST_HOOKS=true.
  const hooks = await request.post(`${API_URL}/test/market/session`, { data: { state: 'auto' } });
  expect(hooks.status(), 'Test hooks are disabled: set ENABLE_TEST_HOOKS=true in backend/.env and restart the API').toBe(200);
  await request.post(`${API_URL}/test/market/resume`);
});
