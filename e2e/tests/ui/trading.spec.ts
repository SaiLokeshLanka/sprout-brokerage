import { expect, test } from '../../src/fixtures';
import { deliveryCharges, inrPaise, tick5 } from '../../src/utils/money';

test.describe('Trading', () => {
  test('a market buy shows its charges first, then debits the wallet and creates a holding', { tag: '@smoke' }, async ({ trader, market, stockPage, fundsPage }) => {
    const price = await market.pricedAt('TCS');
    const charges = deliveryCharges('BUY', 2 * price);
    const panel = stockPage.orderPanel;

    await stockPage.goto('TCS');
    await panel.qty.fill('2');
    await expect(panel.chargesTotal).toHaveText(inrPaise(charges));
    await expect(panel.youPay).toHaveText(inrPaise(2 * price + charges));
    await panel.placeButton.click();

    await expect(panel.result).toContainText(`Bought 2 × TCS @ ${inrPaise(price)}`);
    await expect(stockPage.position).toContainText('Shares2');

    // The money really left the wallet: the ledger shows the trade and, separately, its charges.
    await fundsPage.goto();
    await expect(fundsPage.balance).toHaveText(inrPaise(10_000_000 - 2 * price - charges));
    await expect(fundsPage.transactions.nth(0)).toHaveAttribute('data-type', 'CHARGES');
    await expect(fundsPage.transactions.nth(1)).toHaveAttribute('data-type', 'TRADE_BUY');
    expect((await trader.api.wallet()).balancePaise).toBe(10_000_000 - 2 * price - charges);
  });

  test('a limit buy waits with money blocked, then fills when the price drops', async ({ trader, market, stockPage, fundsPage, ordersPage }) => {
    const price = await market.pricedAt('INFY');
    const limit = tick5(price * 0.98);

    await stockPage.goto('INFY');
    await stockPage.orderPanel.placeOrder({ type: 'limit', limitPaise: limit });
    await expect(stockPage.orderPanel.result).toContainText('Limit order placed');

    // Blocked = limit price × qty + the charges at that price.
    await fundsPage.goto();
    await expect(fundsPage.blocked).toHaveText(inrPaise(limit + deliveryCharges('BUY', limit)));

    await ordersPage.goto();
    await expect(ordersPage.latestStatus()).toHaveText('OPEN');
    // The price reaches the limit on the server — the open page updates live, no reload.
    await market.setPrice('INFY', limit);
    await expect(ordersPage.latestStatus()).toHaveText('EXECUTED');
  });

  test('cancelling an open order releases the blocked money', async ({ trader, market, stockPage, ordersPage, fundsPage }) => {
    const price = await market.pricedAt('HDFCBANK');
    await stockPage.goto('HDFCBANK');
    await stockPage.orderPanel.placeOrder({ type: 'limit', limitPaise: tick5(price * 0.95) });
    await expect(stockPage.orderPanel.result).toContainText('Limit order placed');

    await ordersPage.goto();
    await ordersPage.cancelLatest();
    await expect(ordersPage.notice).toHaveText('Order cancelled');
    await expect(ordersPage.latestStatus()).toHaveText('CANCELLED');

    await fundsPage.goto();
    await expect(fundsPage.blocked).toHaveText('₹0.00');
    await expect(fundsPage.balance).toHaveText('₹1,00,000.00');
  });

  test('selling at a higher price books a realised profit', async ({ trader, market, stockPage, investmentsPage }) => {
    const buyAt = await market.pricedAt('ITC');
    const sellAt = tick5(buyAt * 1.02);

    await stockPage.goto('ITC');
    await stockPage.orderPanel.buy(3);
    await expect(stockPage.orderPanel.result).toContainText('Bought 3 × ITC');

    await market.setPrice('ITC', sellAt);
    await stockPage.orderPanel.sell(3);
    await expect(stockPage.orderPanel.result).toContainText(`Sold 3 × ITC @ ${inrPaise(sellAt)}`);

    await investmentsPage.goto();
    await expect(investmentsPage.realizedAllTime).toHaveText(inrPaise(3 * (sellAt - buyAt)));
  });

  test('selling a stock you do not own is rejected by the server', async ({ trader, stockPage }) => {
    await stockPage.goto('WIPRO');
    await stockPage.orderPanel.side('SELL');
    await stockPage.orderPanel.placeButton.click();
    await expect(stockPage.orderPanel.result).toHaveText("Order rejected: You don't hold this stock");
  });

  test('adding money shows the new balance', async ({ trader, fundsPage }) => {
    await fundsPage.goto();
    await fundsPage.addMoney('2500.50');
    await expect(fundsPage.result).toContainText('Added');
    await expect(fundsPage.balance).toHaveText('₹1,02,500.50');
  });
});
