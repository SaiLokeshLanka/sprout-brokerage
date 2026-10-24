import { expect, test } from '../../src/fixtures';
import { inrPaise } from '../../src/utils/money';

test.describe('Live prices', () => {
  test('the stock page shows the exact price set on the server', async ({ trader, market, stockPage }) => {
    const price = await market.pricedAt('TCS', 1.01);
    await stockPage.goto('TCS');
    await expect(stockPage.price).toHaveText(inrPaise(price));
  });

  test('a price change on the server reaches the open page live (WebSocket)', async ({ trader, market, stockPage }) => {
    await market.pause();
    await stockPage.goto('INFY');
    // Change the price while the page is already open — no reload.
    const price = await market.pricedAt('INFY', 0.98);
    await expect(stockPage.price).toHaveText(inrPaise(price));
  });

  test('buying is blocked while the market is closed', async ({ trader, market, stockPage }) => {
    await stockPage.goto('RELIANCE');
    await expect(stockPage.orderPanel.placeButton).toBeEnabled();

    await market.close();
    await expect(stockPage.header.marketStatus).toContainText('Market closed');
    await expect(stockPage.orderPanel.marketClosedWarning).toBeVisible();
    await expect(stockPage.orderPanel.placeButton).toBeDisabled();
  });

  test('search finds a stock by name and opens it', async ({ trader, explorePage, stockPage, page }) => {
    await explorePage.goto();
    await explorePage.header.search('infos');
    await explorePage.header.searchResults.getByText('Infosys').click();
    await expect(page).toHaveURL(/\/stocks\/INFY$/);
    await expect(stockPage.name).toHaveText('Infosys');
  });
});
