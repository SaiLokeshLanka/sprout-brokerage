import { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BasePage } from './BasePage';

export class ReportsPage extends BasePage {
  readonly from: Locator;
  readonly to: Locator;
  readonly error: Locator;
  readonly downloadButton: Locator;
  readonly pnlTotal: Locator;
  readonly pnlCharges: Locator;
  readonly pnlNet: Locator;
  readonly tradeRows: Locator;
  readonly statementRows: Locator;
  readonly statementClosing: Locator;

  constructor(page: Page) {
    super(page);
    this.from = page.getByTestId('report-from');
    this.to = page.getByTestId('report-to');
    this.error = page.getByTestId('report-error');
    this.downloadButton = page.getByTestId('report-download');
    this.pnlTotal = page.getByTestId('pnl-total');
    this.pnlCharges = page.getByTestId('pnl-charges');
    this.pnlNet = page.getByTestId('pnl-net');
    this.tradeRows = page.getByTestId('trade-row');
    this.statementRows = page.getByTestId('statement-row');
    this.statementClosing = page.getByTestId('statement-closing');
  }

  goto(tab: 'pnl' | 'trades' | 'statement' = 'pnl') {
    return this.open(tab === 'pnl' ? '/reports' : `/reports?tab=${tab}`);
  }

  async tab(tab: 'pnl' | 'trades' | 'statement') {
    await this.page.getByTestId(`report-tab-${tab}`).click();
  }

  pnlRow(symbol: string) {
    return this.page.getByTestId(`pnl-row-${symbol}`);
  }

  contractNoteLink(date: string) {
    return this.page.getByTestId(`contract-note-${date}`);
  }

  /**
   * Clicks Download CSV and returns the file name and contents.
   * Start waiting for the 'download' event BEFORE clicking, or a fast download can be missed.
   */
  async downloadCsv() {
    const downloadPromise = this.page.waitForEvent('download');
    await this.downloadButton.click();
    const download = await downloadPromise;
    return { filename: download.suggestedFilename(), text: readFileSync((await download.path())!, 'utf8') };
  }
}
