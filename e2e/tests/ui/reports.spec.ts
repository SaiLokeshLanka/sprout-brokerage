import { expect, test } from '../../src/fixtures';
import { todayIst } from '../../src/utils/dates';
import { inr, inrPaise, tick5 } from '../../src/utils/money';

test.describe('Portfolio & reports', () => {
  test('the P&L report shows profit, charges and net, and downloads as CSV', async ({ trader, market, reportsPage }) => {
    // Arrange through the API: buy 2, price rises, sell 2.
    const buyAt = await market.pricedAt('TCS');
    const sellAt = tick5(buyAt * 1.02);
    const buy = await trader.api.buy('TCS', 2);
    await market.setPrice('TCS', sellAt);
    const sell = await trader.api.sell('TCS', 2);
    const profit = 2 * (sellAt - buyAt);
    const charges = buy.chargesPaise + sell.chargesPaise;

    await reportsPage.goto();
    await expect(reportsPage.pnlRow('TCS').getByTestId('pnl-row-realized')).toHaveText(inrPaise(profit));
    await expect(reportsPage.pnlTotal).toHaveText(inrPaise(profit));
    await expect(reportsPage.pnlCharges).toHaveText(inrPaise(charges));
    await expect(reportsPage.pnlNet).toHaveText(inrPaise(profit - charges));

    const csv = await reportsPage.downloadCsv();
    expect(csv.filename).toMatch(/^sprout-pnl-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.text.split('\r\n')[0]).toContain('Symbol,Name,Trades');
    expect(csv.text).toContain('TCS,Tata Consultancy Services,2,2,');
    // … realised P&L, charges, net P&L at the end of the TCS row.
    const r = (paise: number) => (paise / 100).toFixed(2);
    expect(csv.text).toContain(`,${r(profit)},${r(charges)},${r(profit - charges)}\r\n`);
  });

  test('the trade book links to a printable contract note', async ({ trader, market, reportsPage, contractNotePage }) => {
    const price = await market.pricedAt('INFY');
    const buy = await trader.api.buy('INFY', 5);
    const sell = await trader.api.sell('INFY', 2);

    await reportsPage.goto();
    await reportsPage.tab('trades');
    await expect(reportsPage.tradeRows).toHaveCount(2);
    await reportsPage.contractNoteLink(todayIst()).click();

    await expect(contractNotePage.rows).toHaveCount(2);
    // Bought 5, sold 2 at the same price → you pay for 3 shares, plus the charges on both trades.
    const charges = buy.chargesPaise + sell.chargesPaise;
    await expect(contractNotePage.charges).toContainText(inrPaise(charges));
    await expect(contractNotePage.charge('brokerage')).toContainText(inr(0)); // delivery is brokerage-free
    await expect(contractNotePage.net).toContainText('Net amount payable');
    await expect(contractNotePage.net).toContainText(inrPaise(3 * price + charges));
    await expect(contractNotePage.printButton).toBeVisible();
  });

  test('the statement lists cash movements with the right closing balance', async ({ trader, market, reportsPage }) => {
    const price = await market.pricedAt('ITC');
    const buy = await trader.api.buy('ITC', 10);

    await reportsPage.goto('statement');
    await expect(reportsPage.statementRows).toHaveCount(3); // welcome bonus, the buy, its charges
    await expect(reportsPage.statementClosing).toHaveText(inrPaise(10_000_000 - 10 * price - buy.chargesPaise));
  });

  test('the investments page shows sector allocation and realised P&L today', async ({ trader, market, investmentsPage }) => {
    const tcs = await market.pricedAt('TCS');
    await market.pricedAt('RELIANCE');
    await trader.api.buy('TCS', 2);
    await trader.api.buy('RELIANCE', 2);
    await market.setPrice('TCS', tcs + 500); // +₹5 per share
    await trader.api.sell('TCS', 1);

    await investmentsPage.goto();
    await expect(investmentsPage.allocationRows).toHaveCount(2); // IT and Oil & Gas
    await expect(investmentsPage.realizedToday).toHaveText(inr(5));
  });

  test('an invalid date range shows the server error', async ({ trader, reportsPage }) => {
    await reportsPage.goto();
    await reportsPage.from.fill('2015-01-01'); // more than 5 years before "to"
    await expect(reportsPage.error).toHaveText('Date range can be at most 5 years');
  });
});
