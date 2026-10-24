import { Page } from '@playwright/test';
import { Header } from './components/Header';

/**
 * Every page object extends this. A page object knows WHERE things are on one page
 * (locators) and HOW to do things there (actions). Tests only say WHAT should happen,
 * so when the UI changes, only the page object needs updating — not every test.
 */
export abstract class BasePage {
  readonly header: Header;

  constructor(readonly page: Page) {
    this.header = new Header(page);
  }

  /** Navigate to a path inside the app (the base URL comes from playwright.config.ts). */
  protected async open(path: string) {
    await this.page.goto(path);
  }

  /** Waits until web fonts are loaded — needed before taking screenshots. */
  async fontsReady() {
    await this.page.evaluate(() => document.fonts.ready);
  }
}
