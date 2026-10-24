import { Locator, Page } from '@playwright/test';
import { rupeesText } from '../../utils/money';

export type OrderTypeName = 'market' | 'limit' | 'sl' | 'sl_m';

/**
 * The Buy/Sell panel on a stock page (and the option ticket on the F&O page).
 * Prices passed to the actions are in paise, like everywhere else in the tests.
 */
export class OrderPanel {
  readonly root: Locator;
  readonly qty: Locator;
  readonly limitPrice: Locator;
  readonly triggerPrice: Locator;
  readonly placeButton: Locator;
  readonly result: Locator;
  readonly typeHelp: Locator;
  readonly youPay: Locator;
  readonly charges: Locator;
  readonly chargesTotal: Locator;
  readonly previewError: Locator;
  readonly holding: Locator;
  readonly marketClosedWarning: Locator;
  readonly insufficientWarning: Locator;
  readonly gtt: GttForm;

  constructor(page: Page) {
    this.root = page.getByTestId('order-panel');
    const id = (testId: string) => this.root.getByTestId(testId);
    this.qty = id('order-qty');
    this.limitPrice = id('order-limit-price');
    this.triggerPrice = id('order-trigger-price');
    this.placeButton = id('place-order');
    this.result = id('order-result');
    this.typeHelp = id('ordertype-help');
    this.youPay = id('order-approx');
    this.charges = id('order-charges');
    this.chargesTotal = id('order-charges-total');
    this.previewError = id('order-preview-error');
    this.holding = id('order-holding');
    this.marketClosedWarning = id('market-closed-warning');
    this.insufficientWarning = id('insufficient-warning');
    this.gtt = new GttForm(this.root);
  }

  async side(side: 'BUY' | 'SELL') {
    await this.root.getByTestId(`side-${side.toLowerCase()}`).click();
  }

  async type(type: OrderTypeName) {
    await this.root.getByTestId(`ordertype-${type}`).click();
  }

  async mode(mode: 'regular' | 'gtt') {
    await this.root.getByTestId(`mode-${mode}`).click();
  }

  /** Opens the charges breakdown and returns the locator of one charge, e.g. charge('brokerage'). */
  async charge(name: 'brokerage' | 'stt' | 'exchange' | 'sebi' | 'stampDuty' | 'gst') {
    const open = await this.charges.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!open) await this.charges.locator('summary').click();
    return this.root.getByTestId(`charge-${name}`);
  }

  /**
   * Fills in and submits an order. Only the fields given are changed:
   *   await panel.placeOrder({ side: 'SELL', type: 'sl_m', qty: 5, triggerPaise: 98000 })
   */
  async placeOrder(o: { side?: 'BUY' | 'SELL'; type?: OrderTypeName; qty?: number; limitPaise?: number; triggerPaise?: number }) {
    if (o.side) await this.side(o.side);
    if (o.type) await this.type(o.type);
    if (o.qty !== undefined) await this.qty.fill(String(o.qty));
    if (o.triggerPaise !== undefined) await this.triggerPrice.fill(rupeesText(o.triggerPaise));
    if (o.limitPaise !== undefined) await this.limitPrice.fill(rupeesText(o.limitPaise));
    await this.placeButton.click();
  }

  buy(qty: number) {
    return this.placeOrder({ side: 'BUY', type: 'market', qty });
  }

  sell(qty: number) {
    return this.placeOrder({ side: 'SELL', type: 'market', qty });
  }
}

/** The GTT tab of the order panel. */
export class GttForm {
  readonly qty: Locator;
  readonly trigger: Locator;
  readonly limit: Locator;
  readonly stopTrigger: Locator;
  readonly stopLimit: Locator;
  readonly createButton: Locator;
  readonly result: Locator;

  constructor(private readonly root: Locator) {
    this.qty = root.getByTestId('gtt-qty');
    this.trigger = root.getByTestId('gtt-trigger');
    this.limit = root.getByTestId('gtt-limit');
    this.stopTrigger = root.getByTestId('gtt-stop-trigger');
    this.stopLimit = root.getByTestId('gtt-stop-limit');
    this.createButton = root.getByTestId('create-gtt');
    this.result = root.getByTestId('gtt-result');
  }

  async kind(kind: 'single' | 'oco') {
    await this.root.getByTestId(`gtt-kind-${kind}`).click();
  }

  /** Target above the price and stop-loss below it; limit prices equal the triggers unless given. */
  async createOco(o: { qty: number; targetPaise: number; stopPaise: number; stopLimitPaise?: number }) {
    await this.kind('oco');
    await this.qty.fill(String(o.qty));
    await this.trigger.fill(rupeesText(o.targetPaise));
    await this.limit.fill(rupeesText(o.targetPaise));
    await this.stopTrigger.fill(rupeesText(o.stopPaise));
    await this.stopLimit.fill(rupeesText(o.stopLimitPaise ?? o.stopPaise));
    await this.createButton.click();
  }
}
