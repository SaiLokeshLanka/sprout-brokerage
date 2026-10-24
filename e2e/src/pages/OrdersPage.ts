import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export type OrdersFilter = 'all' | 'open' | 'executed' | 'closed' | 'gtt';

export class OrdersPage extends BasePage {
  readonly table: Locator;
  readonly gttTable: Locator;
  readonly notice: Locator;

  constructor(page: Page) {
    super(page);
    this.table = page.getByTestId('orders-table');
    this.gttTable = page.getByTestId('gtt-table');
    this.notice = page.getByTestId('orders-notice');
  }

  goto(filter: OrdersFilter = 'all') {
    if (filter === 'gtt') return this.open('/orders?tab=gtt');
    return this.open(filter === 'all' ? '/orders' : `/orders?filter=${filter.toUpperCase()}`);
  }

  filterTab(filter: OrdersFilter) {
    return this.page.getByTestId(`orders-filter-${filter}`);
  }

  async filter(filter: OrdersFilter) {
    await this.filterTab(filter).click();
  }

  /** Order rows, optionally only those containing some text (e.g. 'SL-M' or 'Settled at expiry'). */
  rows(hasText?: string) {
    return this.table.locator('tbody tr', hasText ? { hasText } : {});
  }

  /** Rows whose order has this server status, e.g. 'TRIGGER_PENDING'. */
  rowsWithStatus(status: string) {
    return this.table.locator(`tbody tr[data-status="${status}"]`);
  }

  /** The status text of the newest order (top row). */
  latestStatus() {
    return this.rows().first().getByTestId('order-status');
  }

  async cancelLatest() {
    await this.rows().first().getByTestId('cancel-order').click();
  }

  gttRows() {
    return this.gttTable.locator('tbody tr');
  }

  async cancelLatestGtt() {
    await this.gttRows().first().getByTestId('cancel-gtt').click();
  }
}
