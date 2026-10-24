import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { AdvancedChart } from './components/AdvancedChart';
import { OrderPanel } from './components/OrderPanel';

export class StockPage extends BasePage {
  readonly name: Locator;
  readonly price: Locator;
  readonly position: Locator;
  readonly orderPanel: OrderPanel;
  readonly chart: AdvancedChart;

  constructor(page: Page) {
    super(page);
    this.name = page.getByTestId('stock-name');
    this.price = page.getByTestId('stock-ltp');
    this.position = page.getByTestId('your-position');
    this.orderPanel = new OrderPanel(page);
    this.chart = new AdvancedChart(page);
  }

  goto(symbol: string) {
    return this.open(`/stocks/${symbol}`);
  }

  async chartMode(mode: 'simple' | 'advanced') {
    await this.page.getByTestId(`chart-mode-${mode}`).click();
  }
}
