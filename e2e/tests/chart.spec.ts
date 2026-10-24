import { expect, test } from '@playwright/test';
import { API, loginAsNewUser, prevClose, resetMarket, setPrice, tick5 } from './helpers';

test.describe('Advanced chart', () => {
  test.afterEach(async ({ request }) => resetMarket(request));

  test('candles load and the SMA 20 matches the last 20 closes', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    await setPrice(request, 'TCS', tick5(await prevClose(request, 'TCS'))); // also freezes prices

    await page.goto('/stocks/TCS');
    await page.getByTestId('chart-mode-advanced').click();
    const chart = page.getByTestId('candle-chart');
    await expect(chart).toHaveAttribute('data-state', 'ready');

    // Work out SMA 20 from the same candles the chart loaded, then compare with the legend.
    const { candles } = await (await request.get(`${API}/market/candles/TCS?range=1D&format=ohlc`)).json();
    await expect(chart).toHaveAttribute('data-candles', String(candles.length));
    const last20 = candles.slice(-20).map((c: { c: number }) => c.c / 100);
    const sma = last20.reduce((s: number, v: number) => s + v, 0) / 20;
    const shown = Number((await page.getByTestId('ind-sma-value').textContent())!.replace('SMA 20 ', ''));
    expect(Math.abs(shown - sma)).toBeLessThanOrEqual(0.01); // the legend rounds to 2 decimals

    // RSI is always between 0 and 100.
    const rsi = Number((await page.getByTestId('ind-rsi-value').textContent())!.replace('RSI 14 ', ''));
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });

  test('indicators switch on and off, each with its own strip', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    await page.goto('/stocks/INFY');
    await page.getByTestId('chart-mode-advanced').click();
    await expect(page.getByTestId('candle-chart')).toHaveAttribute('data-state', 'ready');

    await expect(page.getByTestId('macd-pane')).toBeHidden();
    await page.getByTestId('indicator-macd').click();
    await expect(page.getByTestId('indicator-macd')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('macd-pane')).toBeVisible();
    await expect(page.getByTestId('ind-macd-value')).toContainText('signal');

    await page.getByTestId('indicator-rsi').click();
    await expect(page.getByTestId('rsi-pane')).toBeHidden();
    await expect(page.getByTestId('ind-rsi-value')).toHaveCount(0);

    // A longer range swaps in daily candles.
    await page.getByTestId('adv-range-1Y').click();
    await expect(page.getByTestId('candle-chart')).toHaveAttribute('data-candles', '250');
  });
});
