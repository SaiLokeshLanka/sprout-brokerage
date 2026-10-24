import { expect, test } from '../../src/fixtures';

test.describe('Advanced chart', () => {
  test('candles load and the SMA 20 matches the last 20 closes', async ({ trader, market, api, stockPage }) => {
    await market.pricedAt('TCS'); // also freezes prices, so the chart and our numbers agree
    await stockPage.goto('TCS');
    await stockPage.chartMode('advanced');
    await stockPage.chart.waitUntilLoaded();

    // Work out SMA 20 from the same candles the chart loaded, then compare with the legend.
    const { body } = await api.call<{ candles: { c: number }[] }>('GET', '/market/candles/TCS?range=1D&format=ohlc');
    expect(await stockPage.chart.candleCount()).toBe(body.candles.length);
    const sma = body.candles.slice(-20).reduce((s, c) => s + c.c / 100, 0) / 20;
    expect(Math.abs((await stockPage.chart.legendValue('sma')) - sma)).toBeLessThanOrEqual(0.01); // legend rounds to 2 decimals

    const rsi = await stockPage.chart.legendValue('rsi');
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });

  test('indicators switch on and off, each with its own strip', async ({ trader, stockPage }) => {
    const chart = stockPage.chart;
    await stockPage.goto('INFY');
    await stockPage.chartMode('advanced');
    await chart.waitUntilLoaded();

    await expect(chart.macdPane).toBeHidden();
    await chart.indicator('macd').click();
    await expect(chart.indicator('macd')).toHaveAttribute('aria-pressed', 'true');
    await expect(chart.macdPane).toBeVisible();
    await expect(chart.legend('macd')).toContainText('signal');

    await chart.indicator('rsi').click();
    await expect(chart.rsiPane).toBeHidden();
    await expect(chart.legend('rsi')).toHaveCount(0);

    // A longer range swaps in daily candles.
    await chart.range('1Y');
    await expect(chart.canvas).toHaveAttribute('data-candles', '250');
  });
});
