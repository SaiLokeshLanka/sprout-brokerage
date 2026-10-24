import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class InvestmentsPage extends BasePage {
  readonly summary: Locator;
  readonly holdings: Locator;
  readonly allocationRows: Locator;
  readonly realizedToday: Locator;
  readonly realizedAllTime: Locator;
  readonly optionPositions: Locator;

  constructor(page: Page) {
    super(page);
    this.summary = page.getByTestId('investment-summary');
    this.holdings = page.getByTestId('holdings-table');
    this.allocationRows = page.getByTestId('alloc-row');
    this.realizedToday = page.getByTestId('funds-realized-today');
    this.realizedAllTime = page.getByTestId('funds-realized');
    this.optionPositions = page.getByTestId('option-positions');
  }

  goto() {
    return this.open('/investments');
  }

  holding(symbol: string) {
    return this.page.getByTestId(`holding-${symbol}`);
  }

  optionPosition(symbol: string) {
    return this.page.getByTestId(`position-${symbol}`);
  }
}
