import { expect, Locator, Page } from '@playwright/test';

export type IndicatorName = 'sma' | 'ema' | 'bb' | 'volume' | 'rsi' | 'macd';

/** The candlestick chart with indicators on a stock page. */
export class AdvancedChart {
  readonly canvas: Locator;
  readonly rsiPane: Locator;
  readonly macdPane: Locator;

  constructor(private readonly page: Page) {
    this.canvas = page.getByTestId('candle-chart');
    this.rsiPane = page.getByTestId('rsi-pane');
    this.macdPane = page.getByTestId('macd-pane');
  }

  async waitUntilLoaded() {
    await expect(this.canvas).toHaveAttribute('data-state', 'ready');
  }

  /** How many candles the chart is drawing. */
  async candleCount() {
    return Number(await this.canvas.getAttribute('data-candles'));
  }

  indicator(name: IndicatorName) {
    return this.page.getByTestId(`indicator-${name}`);
  }

  legend(name: Exclude<IndicatorName, 'volume'>) {
    return this.page.getByTestId(`ind-${name}-value`);
  }

  /** The number shown in the legend, e.g. 72.86 from "RSI 14 72.86". */
  async legendValue(name: 'sma' | 'ema' | 'rsi') {
    const text = (await this.legend(name).textContent()) ?? '';
    return Number(text.split(' ').pop());
  }

  async range(range: '1D' | '1W' | '1M' | '1Y' | '5Y') {
    await this.page.getByTestId(`adv-range-${range}`).click();
  }
}
