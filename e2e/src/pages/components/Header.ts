import { Locator, Page } from '@playwright/test';

/** The top bar on every logged-in page: navigation, search, theme, profile menu, market status. */
export class Header {
  readonly profileButton: Locator;
  readonly searchInput: Locator;
  readonly searchResults: Locator;
  readonly themeToggle: Locator;
  readonly marketStatus: Locator;

  constructor(private readonly page: Page) {
    this.profileButton = page.getByTestId('profile-button');
    this.searchInput = page.getByTestId('search-input');
    this.searchResults = page.getByTestId('search-results');
    this.themeToggle = page.getByTestId('theme-toggle');
    this.marketStatus = page.getByTestId('market-status');
  }

  nav(name: 'explore' | 'investments' | 'options' | 'orders' | 'watchlist') {
    return this.page.getByTestId(`nav-${name}`);
  }

  async openMenu(item: 'funds' | 'reports' | 'account') {
    await this.profileButton.click();
    await this.page.getByTestId(`menu-${item}`).click();
  }

  async logout() {
    await this.profileButton.click();
    await this.page.getByTestId('logout-button').click();
  }

  async search(text: string) {
    await this.searchInput.fill(text);
  }
}
