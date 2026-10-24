import { expect, test } from '../../src/fixtures';
import { inrPaise, tick5 } from '../../src/utils/money';

test.describe('Stop-loss and GTT orders', () => {
  test('a stop-loss sell waits for its trigger, then sells when the price falls', async ({ trader, market, stockPage, ordersPage }) => {
    const price = await market.pricedAt('ITC');
    const trigger = tick5(price * 0.97);
    await trader.api.buy('ITC', 5);

    await stockPage.goto('ITC');
    const panel = stockPage.orderPanel;
    await panel.side('SELL');
    await panel.type('sl_m');
    await expect(panel.typeHelp).toContainText('executes at the market price');
    await panel.placeOrder({ qty: 5, triggerPaise: trigger });
    await expect(panel.result).toContainText(`Triggers when price falls to ${inrPaise(trigger)}`);

    await ordersPage.goto('open');
    const waiting = ordersPage.rowsWithStatus('TRIGGER_PENDING');
    await expect(waiting.getByTestId('order-status')).toHaveText('TRIGGER PENDING');
    await expect(waiting.getByTestId('order-trigger')).toHaveText(`trigger ${inrPaise(trigger)}`);

    // The price falls through the trigger: the server sells at the market price, the page updates live.
    const fallTo = trigger - 20;
    await market.setPrice('ITC', fallTo);
    await ordersPage.filter('executed');
    const sold = ordersPage.rows('SL-M');
    await expect(sold.getByTestId('order-status')).toHaveText('EXECUTED');
    await expect(sold.getByTestId('order-price')).toContainText(inrPaise(fallTo));
  });

  test('the order panel shows the server rule before you place an invalid stop-loss', async ({ trader, market, stockPage }) => {
    const price = await market.pricedAt('ITC');
    await trader.api.buy('ITC', 1);

    await stockPage.goto('ITC');
    await stockPage.orderPanel.side('SELL');
    await stockPage.orderPanel.type('sl_m');
    await stockPage.orderPanel.triggerPrice.fill((tick5(price * 1.05) / 100).toFixed(2)); // above the price: wrong side
    await expect(stockPage.orderPanel.previewError).toContainText('must be below the current price');
  });

  test('an OCO GTT created in the panel fires its stop-loss leg', async ({ trader, market, stockPage, ordersPage }) => {
    const price = await market.pricedAt('TCS');
    const stop = tick5(price * 0.95);
    await trader.api.buy('TCS', 4);

    await stockPage.goto('TCS');
    await stockPage.orderPanel.side('SELL');
    await stockPage.orderPanel.mode('gtt');
    await stockPage.orderPanel.gtt.createOco({ qty: 4, targetPaise: tick5(price * 1.05), stopPaise: stop, stopLimitPaise: stop - 100 });
    await expect(stockPage.orderPanel.gtt.result).toContainText('GTT created');

    await ordersPage.goto('gtt');
    const gtt = ordersPage.gttRows().first();
    await expect(gtt.getByTestId('gtt-status')).toHaveText('ACTIVE');
    await expect(gtt.getByTestId('gtt-prices')).toContainText(`Stop-loss ${inrPaise(stop)}`);

    await market.setPrice('TCS', stop - 10);
    await expect(gtt.getByTestId('gtt-status')).toHaveText('TRIGGERED');
    await expect(gtt).toContainText('Stop-loss hit');
    await expect(gtt.getByTestId('cancel-gtt')).toHaveCount(0);
  });

  test('a GTT can be cancelled from the orders page', async ({ trader, market, ordersPage }) => {
    const price = await market.pricedAt('INFY');
    const created = await trader.api.createGtt({
      symbol: 'INFY',
      side: 'BUY',
      kind: 'SINGLE',
      qty: 1,
      triggerPricePaise: tick5(price * 0.9),
      limitPricePaise: tick5(price * 0.9),
    });
    expect(created.status).toBe(201);

    await ordersPage.goto();
    await expect(ordersPage.filterTab('gtt')).toHaveText('GTT (1 active)');
    await ordersPage.filter('gtt');
    await ordersPage.cancelLatestGtt();
    await expect(ordersPage.notice).toHaveText('GTT cancelled');
    await expect(ordersPage.gttRows().first().getByTestId('gtt-status')).toHaveText('CANCELLED');
  });
});
