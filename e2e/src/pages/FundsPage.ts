import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class FundsPage extends BasePage {
  readonly balance: Locator;
  readonly blocked: Locator;
  readonly withdrawable: Locator;
  readonly transactions: Locator;
  readonly amount: Locator;
  readonly submit: Locator;
  readonly result: Locator;
  readonly kycRequired: Locator;

  constructor(page: Page) {
    super(page);
    this.balance = page.getByTestId('wallet-balance');
    this.blocked = page.getByTestId('wallet-blocked');
    this.withdrawable = page.getByTestId('wallet-withdrawable');
    this.transactions = page.getByTestId('txn-row');
    this.amount = page.getByTestId('funds-amount');
    this.submit = page.getByTestId('funds-submit');
    this.result = page.getByTestId('funds-result');
    this.kycRequired = page.getByTestId('kyc-required');
  }

  goto(tab: 'add' | 'withdraw' = 'add') {
    return this.open(tab === 'add' ? '/funds' : '/funds?tab=withdraw');
  }

  async tab(tab: 'add' | 'withdraw') {
    await this.page.getByTestId(`funds-tab-${tab}`).click();
  }

  /** Amount in rupees, typed as the user would. */
  async addMoney(rupees: string) {
    await this.tab('add');
    await this.amount.fill(rupees);
    await this.submit.click();
  }
}
