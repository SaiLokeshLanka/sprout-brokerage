import { expect, test } from '../../src/fixtures';
import { DEMO_USER, newUserData } from '../../src/data/users';
import { WEB_URL } from '../../src/config';

test.describe('Login and sign-up', () => {
  test('a logged-out visitor is sent to the login page', async ({ page, loginPage }) => {
    await page.goto('/funds');
    await expect(page).toHaveURL(/\/login$/);
    await expect(loginPage.heading).toBeVisible();
  });

  test('wrong credentials show an error message', async ({ page, loginPage }) => {
    await loginPage.goto();
    // An email that doesn't exist — never the demo user, so we can't trigger its 5-attempt lockout.
    await loginPage.login('nobody@sprout.dev', 'Wrong1234');
    await expect(loginPage.error).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the form checks the email before calling the server', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.login('not-an-email', 'whatever');
    await expect(loginPage.error).toHaveText('Enter a valid email address');
  });

  test('the demo user can log in and log out', { tag: '@smoke' }, async ({ page, loginPage, explorePage }) => {
    await loginPage.goto();
    await loginPage.demoButton.click(); // fills the demo email + password
    await expect(loginPage.email).toHaveValue(DEMO_USER.email);
    await loginPage.submit.click();
    await expect(explorePage.indexStrip).toBeVisible();

    await explorePage.header.logout();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a new user can sign up and lands on Explore with ₹1,00,000', async ({ loginPage, explorePage, fundsPage }) => {
    const user = newUserData({ fullName: 'Asha Verma' });
    await loginPage.goto();
    await loginPage.register(user.fullName, user.email, user.password);
    await expect(explorePage.indexStrip).toBeVisible();

    await fundsPage.goto();
    await expect(fundsPage.balance).toHaveText('₹1,00,000.00');
  });
});

test.describe('Sessions', () => {
  test('a logged-in user stays logged in after reloading the page', async ({ trader, page, explorePage }) => {
    await explorePage.goto();
    await expect(explorePage.indexStrip).toBeVisible();
    await page.reload();
    await expect(explorePage.indexStrip).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
    expect(trader.user.email).toBe(trader.email);
  });

  test('a saved session (storageState) logs a new browser in', async ({ trader, page, browser, explorePage }) => {
    await explorePage.goto();
    await expect(explorePage.indexStrip).toBeVisible();

    // storageState = the browser's cookies and local storage, saved as JSON. Loading it into a new
    // browser context is how Playwright suites usually skip the login screen.
    const saved = await page.context().storageState();
    expect(saved.cookies.map((c) => c.name)).toContain('sprout_rt'); // the httpOnly refresh cookie

    const context = await browser.newContext({ storageState: saved, baseURL: WEB_URL });
    const second = await context.newPage();
    await second.goto('/');
    await expect(second.getByTestId('index-strip')).toBeVisible();
    await context.close();
  });

  test('replaying an old saved session is treated as theft and logs the user out everywhere', { tag: '@slow' }, async ({ trader, page, browser, explorePage }) => {
    // Sprout rotates the refresh cookie on every use. Reusing an old one more than 30 seconds
    // later looks like a stolen cookie, so the server ends ALL of the user's sessions.
    // That is why this framework logs in fresh for every test instead of sharing one saved session.
    test.slow(); // waits 31 seconds: allow 3× the normal timeout
    await explorePage.goto();
    await expect(explorePage.indexStrip).toBeVisible();
    const stale = await page.context().storageState(); // cookie A

    await page.reload(); // the app refreshes: cookie A is replaced by cookie B
    await expect(explorePage.indexStrip).toBeVisible();
    await page.waitForTimeout(31_000);

    const thief = await browser.newContext({ storageState: stale, baseURL: WEB_URL });
    const thiefPage = await thief.newPage();
    await thiefPage.goto('/');
    await expect(thiefPage).toHaveURL(/\/login$/); // cookie A is refused…
    await thief.close();

    await page.reload();
    await expect(page).toHaveURL(/\/login$/); // …and the real user's session was ended too
  });
});
