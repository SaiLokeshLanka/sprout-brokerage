import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useMarket } from '../market/MarketContext';
import { OrderType, Product, Side, useTrade } from '../store/TradeContext';
import { formatINR, formatPaise, roundToTick } from '../utils/format';

interface Charges {
  brokeragePaise: number;
  sttPaise: number;
  exchangePaise: number;
  sebiPaise: number;
  stampDutyPaise: number;
  gstPaise: number;
  totalPaise: number;
}

interface Preview {
  valuePaise: number;
  charges: Charges;
  totalPaise: number;
  sufficientFunds: boolean;
}

const CHARGE_LABELS: [keyof Charges, string][] = [
  ['brokeragePaise', 'Brokerage'],
  ['sttPaise', 'STT (Securities Transaction Tax)'],
  ['exchangePaise', 'Exchange transaction charge'],
  ['sebiPaise', 'SEBI fee'],
  ['stampDutyPaise', 'Stamp duty'],
  ['gstPaise', 'GST (18%)'],
];

const TYPE_LABELS: Record<OrderType, string> = { MARKET: 'Market', LIMIT: 'Limit', SL: 'SL', SL_M: 'SL-M' };
const TYPE_HELP: Record<OrderType, string> = {
  MARKET: 'Buy or sell now at the current price.',
  LIMIT: 'Executes only at your price or better.',
  SL: 'Stop-loss: when the price reaches the trigger, a limit order is placed at your limit price.',
  SL_M: 'Stop-loss market: when the price reaches the trigger, it executes at the market price.',
};

interface OrderPanelProps {
  symbol: string;
  /** Live price in rupees. */
  ltp: number;
  title?: string;
  /** Options trade in lots: the quantity box counts lots and orders send lots × lotSize units. */
  lotSize?: number;
  /** Units held, when the holding isn't a stock in the trade context (option positions). */
  heldQty?: number;
  /** Stocks only: product choice and GTT. */
  stock?: boolean;
  onPlaced?: () => void;
}

export function OrderPanel({ symbol, ltp, title, lotSize = 1, heldQty, stock = true, onPlaced }: OrderPanelProps) {
  const { placeOrder, availablePaise, state } = useTrade();
  const { bySymbol, status } = useMarket();
  // Pausing (a test hook) only freezes prices; a closed session blocks trading.
  const marketClosed = status !== null && !status.open;
  const [mode, setMode] = useState<'REGULAR' | 'GTT'>('REGULAR');
  const [side, setSide] = useState<Side>('BUY');
  const [product, setProduct] = useState<Product>('DELIVERY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [qty, setQty] = useState('1');
  const [limitPrice, setLimitPrice] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<{ data?: Preview; error?: string } | null>(null);

  useEffect(() => {
    setResult(null);
    setMode('REGULAR');
    setOrderType('MARKET');
    setQty('1');
  }, [symbol]);

  const units = Number(qty) * lotSize;
  const holding = state.holdings[symbol];
  const held = heldQty ?? holding?.qty ?? 0;
  const sellable = heldQty ?? held - (holding?.reservedQty ?? 0);
  const usesLimit = orderType === 'LIMIT' || orderType === 'SL';
  const usesTrigger = orderType === 'SL' || orderType === 'SL_M';

  // Ask the server what this order would cost (value + every charge). Debounced while typing.
  const body = {
    symbol,
    side,
    orderType,
    qty: units,
    ...(stock ? { product } : {}),
    ...(usesLimit && limitPrice ? { limitPricePaise: Math.round(Number(limitPrice) * 100) } : {}),
    ...(usesTrigger && triggerPrice ? { triggerPricePaise: Math.round(Number(triggerPrice) * 100) } : {}),
  };
  const previewKey = JSON.stringify(body);
  const ready = mode === 'REGULAR' && Number.isInteger(units) && units > 0 && (!usesLimit || Number(limitPrice) > 0) && (!usesTrigger || Number(triggerPrice) > 0);
  useEffect(() => {
    if (!ready) return setPreview(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .post<Preview>('/orders/preview', JSON.parse(previewKey))
        .then((data) => !cancelled && setPreview({ data }))
        .catch((err) => !cancelled && setPreview({ error: errorMessage(err) }));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewKey, ready]);

  const switchType = (t: OrderType) => {
    setOrderType(t);
    setResult(null);
    const below = roundToTick(ltp * 0.98).toFixed(2);
    const above = roundToTick(ltp * 1.02).toFixed(2);
    if ((t === 'SL' || t === 'SL_M') && !triggerPrice) setTriggerPrice(side === 'SELL' ? below : above);
    if (t === 'SL' && !limitPrice) setLimitPrice(side === 'SELL' ? below : above);
    if (t === 'LIMIT' && !limitPrice) setLimitPrice(ltp.toFixed(2));
  };

  const switchSide = (s: Side) => {
    setSide(s);
    setResult(null);
    // Stop prices only make sense on one side of the price, so clear them.
    setTriggerPrice('');
    if (orderType === 'SL') setLimitPrice('');
    if (orderType === 'SL' || orderType === 'SL_M') setOrderType('MARKET');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return; // one click = one order
    setPending(true);
    setResult(null);
    const r = await placeOrder({
      symbol,
      side,
      qty: units,
      orderType,
      product,
      limitPrice: usesLimit ? Number(limitPrice) : undefined,
      triggerPrice: usesTrigger ? Number(triggerPrice) : undefined,
    });
    setResult({ ok: r.ok, message: r.message });
    setPending(false);
    if (r.ok) onPlaced?.();
  };

  const unitLabel = lotSize > 1 ? 'units' : 'shares';

  return (
    <div className={`card order-panel ${side === 'SELL' ? 'sell' : 'buy'}`} data-testid="order-panel">
      <div className="order-head">
        <div className="strong">{title ?? bySymbol[symbol]?.name}</div>
        <div className="muted small" data-testid="order-ltp">
          {stock ? 'NSE ' : ''}
          {formatINR(ltp)}
        </div>
      </div>

      <div className="side-tabs" role="tablist">
        {(['BUY', 'SELL'] as Side[]).map((s) => (
          <button
            type="button"
            key={s}
            role="tab"
            aria-selected={side === s}
            className={`side-tab ${side === s ? `active ${s.toLowerCase()}` : ''}`}
            onClick={() => switchSide(s)}
            data-testid={`side-${s.toLowerCase()}`}
          >
            {s === 'BUY' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      {stock && (
        <div className="mode-tabs" role="tablist" aria-label="Order kind">
          {(['REGULAR', 'GTT'] as const).map((m) => (
            <button
              type="button"
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`mode-tab ${mode === m ? 'active' : ''}`}
              onClick={() => {
                setMode(m);
                setResult(null);
              }}
              data-testid={`mode-${m.toLowerCase()}`}
            >
              {m === 'REGULAR' ? 'Regular' : 'GTT'}
            </button>
          ))}
        </div>
      )}

      {mode === 'GTT' ? (
        <GttForm symbol={symbol} ltp={ltp} side={side} held={held} />
      ) : (
        <form onSubmit={submit}>
          <div className="order-body">
            {stock ? (
              <div className="chip-group" role="radiogroup" aria-label="Product">
                {(['DELIVERY', 'INTRADAY'] as Product[]).map((p) => (
                  <button
                    type="button"
                    key={p}
                    role="radio"
                    aria-checked={product === p}
                    className={`chip ${product === p ? 'active' : ''}`}
                    onClick={() => setProduct(p)}
                    data-testid={`product-${p.toLowerCase()}`}
                  >
                    {p === 'DELIVERY' ? 'Delivery' : 'Intraday'}
                  </button>
                ))}
              </div>
            ) : (
              <div className="muted small">Index option · cash-settled at expiry</div>
            )}

            <label className="field">
              <span>{lotSize > 1 ? `Lots (1 lot = ${lotSize} units)` : 'Qty'}</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                data-testid="order-qty"
              />
            </label>

            <div className="field">
              <span>Order type</span>
              <div className="chip-group compact" role="radiogroup" aria-label="Order type">
                {(Object.keys(TYPE_LABELS) as OrderType[]).map((t) => (
                  <button
                    type="button"
                    key={t}
                    role="radio"
                    aria-checked={orderType === t}
                    className={`chip ${orderType === t ? 'active' : ''}`}
                    onClick={() => switchType(t)}
                    data-testid={`ordertype-${t.toLowerCase()}`}
                  >
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              <div className="muted small" data-testid="ordertype-help">
                {TYPE_HELP[orderType]}
              </div>
            </div>

            {usesTrigger && (
              <label className="field">
                <span>Trigger price</span>
                <input
                  type="number"
                  min={0.05}
                  step={0.05}
                  value={triggerPrice}
                  onChange={(e) => setTriggerPrice(e.target.value)}
                  data-testid="order-trigger-price"
                />
              </label>
            )}
            <label className="field">
              <span>{usesLimit ? 'Limit price' : 'Price'}</span>
              {usesLimit ? (
                <input
                  type="number"
                  min={0.05}
                  step={0.05}
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  aria-label="Limit price"
                  data-testid="order-limit-price"
                />
              ) : (
                <input type="text" value="At market" disabled aria-label="Market price" />
              )}
            </label>

            {result && (
              <div className={`order-result ${result.ok ? 'ok' : 'err'}`} role="status" data-testid="order-result">
                {result.message}
                {result.ok && (
                  <>
                    {' '}
                    <Link to="/orders">View orders</Link>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="order-foot">
            <div className="order-meta small">
              {side === 'BUY' ? (
                <span>
                  Balance: <b data-testid="order-balance">{formatPaise(availablePaise)}</b>
                </span>
              ) : (
                <span>
                  Holding:{' '}
                  <b data-testid="order-holding">
                    {held} {unitLabel}
                  </b>
                  {sellable < held && <span className="muted"> ({sellable} free)</span>}
                </span>
              )}
              <span>
                {side === 'BUY' ? 'You pay' : 'You get'} ≈{' '}
                <b data-testid="order-approx">{preview?.data ? formatPaise(preview.data.totalPaise) : '—'}</b>
              </span>
            </div>
            {preview?.data && (
              <details className="charges small" data-testid="order-charges">
                <summary>
                  Value {formatPaise(preview.data.valuePaise)} + charges{' '}
                  <b data-testid="order-charges-total">{formatPaise(preview.data.charges.totalPaise)}</b>
                </summary>
                <dl data-testid="charges-breakdown">
                  {CHARGE_LABELS.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd data-testid={`charge-${key.replace('Paise', '')}`}>{formatPaise(preview.data!.charges[key])}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            {preview?.error && (
              <div className="warn small" data-testid="order-preview-error">
                {preview.error}
              </div>
            )}
            {side === 'BUY' && preview?.data && !preview.data.sufficientFunds && (
              <div className="warn small" data-testid="insufficient-warning">
                Insufficient balance. <Link to="/funds">Add money</Link>
              </div>
            )}
            {marketClosed && (
              <div className="warn small" data-testid="market-closed-warning">
                Market is closed — {status?.reason}
              </div>
            )}
            <button
              type="submit"
              className={`btn-primary ${side === 'SELL' ? 'sell' : ''}`}
              disabled={marketClosed || pending}
              data-testid="place-order"
            >
              {pending ? 'Placing order…' : side === 'BUY' ? 'Buy' : 'Sell'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Good Till Triggered: a standing instruction that lasts up to a year. Nothing is blocked while it waits. */
function GttForm({ symbol, ltp, side, held }: { symbol: string; ltp: number; side: Side; held: number }) {
  const { createGtt } = useTrade();
  const [kind, setKind] = useState<'SINGLE' | 'OCO'>('SINGLE');
  const [qty, setQty] = useState('1');
  const [trigger, setTrigger] = useState('');
  const [limit, setLimit] = useState('');
  const [stopTrigger, setStopTrigger] = useState('');
  const [stopLimit, setStopLimit] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  // Sensible starting prices: 5% away from the current price on the side the trigger must be.
  useEffect(() => {
    const at = (f: number) => roundToTick(ltp * f).toFixed(2);
    const first = kind === 'OCO' || side === 'SELL' ? at(1.05) : at(0.95);
    setTrigger(first);
    setLimit(first);
    setStopTrigger(at(0.95));
    setStopLimit(at(0.95));
    setResult(null);
    if (side === 'BUY') setKind('SINGLE');
    // Only when the instruction changes, not on every price tick.
  }, [symbol, side, kind]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const r = await createGtt({
      symbol,
      side,
      kind,
      qty: Number(qty),
      trigger: Number(trigger),
      limit: Number(limit),
      ...(kind === 'OCO' ? { stopTrigger: Number(stopTrigger), stopLimit: Number(stopLimit) } : {}),
    });
    setResult(r);
    setPending(false);
  };

  const priceInput = (label: string, value: string, set: (v: string) => void, testId: string) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0.05} step={0.05} value={value} onChange={(e) => set(e.target.value)} data-testid={testId} />
    </label>
  );

  return (
    <form onSubmit={submit} data-testid="gtt-form">
      <div className="order-body">
        <div className="chip-group" role="radiogroup" aria-label="GTT type">
          {(['SINGLE', 'OCO'] as const).map((k) => (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={kind === k}
              className={`chip ${kind === k ? 'active' : ''}`}
              onClick={() => setKind(k)}
              disabled={k === 'OCO' && side === 'BUY'}
              title={k === 'OCO' && side === 'BUY' ? 'OCO is for selling shares you hold' : undefined}
              data-testid={`gtt-kind-${k.toLowerCase()}`}
            >
              {k === 'SINGLE' ? 'Single' : 'OCO'}
            </button>
          ))}
        </div>
        <div className="muted small" data-testid="gtt-help">
          {kind === 'SINGLE'
            ? `When the price reaches the trigger, a limit order to ${side === 'BUY' ? 'buy' : 'sell'} is placed. Stays active for a year.`
            : 'Target and stop-loss together: whichever price is reached first places a sell order, and the other is cancelled.'}
        </div>
        <label className="field">
          <span>Qty</span>
          <input type="number" min={1} step={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="gtt-qty" />
        </label>
        {priceInput(kind === 'OCO' ? 'Target trigger' : 'Trigger price', trigger, setTrigger, 'gtt-trigger')}
        {priceInput(kind === 'OCO' ? 'Target limit price' : 'Limit price', limit, setLimit, 'gtt-limit')}
        {kind === 'OCO' && (
          <>
            {priceInput('Stop-loss trigger', stopTrigger, setStopTrigger, 'gtt-stop-trigger')}
            {priceInput('Stop-loss limit price', stopLimit, setStopLimit, 'gtt-stop-limit')}
          </>
        )}
        {result && (
          <div className={`order-result ${result.ok ? 'ok' : 'err'}`} role="status" data-testid="gtt-result">
            {result.message}
            {result.ok && (
              <>
                {' '}
                <Link to="/orders?tab=gtt">View GTTs</Link>
              </>
            )}
          </div>
        )}
      </div>
      <div className="order-foot">
        <div className="order-meta small">
          <span>
            Current price: <b>{formatINR(ltp)}</b>
          </span>
          {side === 'SELL' && <span>Holding: {held} shares</span>}
        </div>
        <button type="submit" className={`btn-primary ${side === 'SELL' ? 'sell' : ''}`} disabled={pending} data-testid="create-gtt">
          {pending ? 'Creating…' : 'Create GTT'}
        </button>
      </div>
    </form>
  );
}
