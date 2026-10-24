import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ExplorePage extends BasePage {
  readonly indexStrip: Locator;
  readonly allStocks: Locator;

  constructor(page: Page) {
    super(page);
    this.indexStrip = page.getByTestId('index-strip');
    this.allStocks = page.getByTestId('all-stocks-table');
  }

  goto() {
    return this.open('/');
  }
}
