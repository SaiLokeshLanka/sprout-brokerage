import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  readonly heading: Locator;
  readonly form: Locator;
  readonly name: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly error: Locator;
  readonly demoButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Welcome back' });
    this.form = page.getByTestId('login-form');
    this.name = page.getByTestId('register-name');
    this.email = page.getByTestId('login-email');
    this.password = page.getByTestId('login-password');
    this.submit = page.getByTestId('login-submit');
    this.error = page.getByTestId('login-error');
    this.demoButton = page.getByTestId('use-demo');
  }

  goto() {
    return this.open('/login');
  }

  async tab(mode: 'login' | 'register') {
    await this.page.getByTestId(`auth-tab-${mode}`).click();
  }

  async login(email: string, password: string) {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }

  async register(fullName: string, email: string, password: string) {
    await this.tab('register');
    await this.name.fill(fullName);
    await this.login(email, password);
  }
}
