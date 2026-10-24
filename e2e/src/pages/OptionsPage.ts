import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { OrderPanel } from './components/OrderPanel';

export class OptionsPage extends BasePage {
  readonly chain: Locator;
  readonly strikeRows: Locator;
  readonly spotRow: Locator;
  readonly lotSize: Locator;
  readonly help: Locator;
  readonly greeks: Locator;
  readonly orderPanel: OrderPanel;

  constructor(page: Page) {
    super(page);
    this.chain = page.getByTestId('option-chain');
    this.strikeRows = page.locator('[data-testid^="strike-"]');
    this.spotRow = page.getByTestId('spot-row');
    this.lotSize = page.getByTestId('chain-lot');
    this.help = page.getByTestId('options-help');
    this.greeks = page.getByTestId('greeks');
    this.orderPanel = new OrderPanel(page);
  }

  goto(underlying: 'NIFTY' | 'BANKNIFTY' = 'NIFTY') {
    return this.open(`/options?underlying=${underlying}`);
  }

  async underlying(name: 'NIFTY' | 'BANKNIFTY') {
    await this.page.getByTestId(`underlying-${name}`).click();
  }

  /** Strike in rupees, e.g. strikeRow(24500). */
  strikeRow(strike: number) {
    return this.page.getByTestId(`strike-${strike}`);
  }

  /** Clicks a contract's premium to open the order ticket. */
  async select(symbol: string) {
    await this.page.getByTestId(`ltp-${symbol}`).click();
  }

  greek(name: 'delta' | 'gamma' | 'theta' | 'vega' | 'iv') {
    return this.page.getByTestId(`greek-${name}`);
  }

  position(symbol: string) {
    return this.page.getByTestId(`position-${symbol}`);
  }
}
