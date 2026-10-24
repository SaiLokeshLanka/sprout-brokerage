import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ContractNotePage extends BasePage {
  readonly note: Locator;
  readonly number: Locator;
  readonly rows: Locator;
  readonly empty: Locator;
  readonly charges: Locator;
  readonly net: Locator;
  readonly printButton: Locator;

  constructor(page: Page) {
    super(page);
    this.note = page.locator('.contract-note');
    this.number = page.getByTestId('cn-number');
    this.rows = page.getByTestId('cn-row');
    this.empty = page.getByTestId('cn-empty');
    this.charges = page.getByTestId('cn-charges');
    this.net = page.getByTestId('cn-net');
    this.printButton = page.getByTestId('print-note');
  }

  goto(date: string) {
    return this.open(`/reports/contract-note/${date}`);
  }

  charge(name: 'brokerage' | 'stt' | 'exchange' | 'sebi' | 'stampDuty' | 'gst') {
    return this.page.getByTestId(`cn-${name}`);
  }
}
