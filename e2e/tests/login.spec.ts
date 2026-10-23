import { expect, test } from '@playwright/test';

// A "describe" groups related tests. Each "test" gets a fresh, empty browser (no cookies, no login).
test.describe('Login', () => {
  test('a logged-out visitor is sent to the login page', async ({ page }) => {
    // Act: open a page that needs login
    await page.goto('/funds');

    // Assert: we end up on /login and see the login form
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('wrong credentials show an error message', async ({ page }) => {
    await page.goto('/login');

    // An email that doesn't exist — not the demo user, so we never trigger its 5-attempt lockout.
    await page.getByTestId('login-email').fill('nobody@sprout.dev');
    await page.getByTestId('login-password').fill('Wrong1234');
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-error')).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login$/); // still on the login page
  });

  test('the form checks the email before calling the server', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('not-an-email');
    await page.getByTestId('login-password').fill('whatever');
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-error')).toHaveText('Enter a valid email address');
  });

  test('the demo user can log in and log out', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('use-demo').click(); // fills the demo email + password
    await page.getByTestId('login-submit').click();

    // Logged in: the Explore page shows the index cards and the market status
    await expect(page.getByTestId('index-strip')).toBeVisible();
    await expect(page.getByTestId('market-status')).toBeVisible();

    // Log out through the profile menu
    await page.getByTestId('profile-button').click();
    await page.getByTestId('logout-button').click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
