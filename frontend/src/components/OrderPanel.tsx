import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMarket } from '../market/MarketContext';
import { OrderType, Product, Side, useTrade } from '../store/TradeContext';
import { formatINR, formatPaise, toPaise } from '../utils/format';

export function OrderPanel({ symbol, ltp }: { symbol: string; ltp: number }) {
  const { placeOrder, availablePaise, state } = useTrade();
  const { bySymbol, status } = useMarket();
  // Pausing (a test hook) only freezes prices; a closed session blocks trading.
  const marketClosed = status !== null && !status.open;
  const [side, setSide] = useState<Side>('BUY');
  const [product, setProduct] = useState<Product>('DELIVERY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [qty, setQty] = useState('1');
  const [limitPrice, setLimitPrice] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setResult(null);
    setOrderType('MARKET');
    setQty('1');
  }, [symbol]);

  const qtyNum = Number(qty);
  const price = orderType === 'MARKET' ? ltp : Number(limitPrice);
  const approxPaise = qtyNum > 0 && price > 0 ? toPaise(price) * qtyNum : 0;
  const holding = state.holdings[symbol];
  const held = holding?.qty ?? 0;
  const sellable = held - (holding?.reservedQty ?? 0);
  const insufficient = side === 'BUY' && approxPaise > availablePaise;

  const switchType = (t: OrderType) => {
    setOrderType(t);
    if (t === 'LIMIT' && !limitPrice) setLimitPrice(ltp.toFixed(2));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return; // one click = one order
    setPending(true);
    setResult(null);
    const r = await placeOrder({
      symbol,
      side,
      qty: qtyNum,
      orderType,
      product,
      limitPrice: orderType === 'LIMIT' ? Number(limitPrice) : undefined,
    });
    setResult({ ok: r.ok, message: r.message });
    setPending(false);
  };

  return (
    <form className={`card order-panel ${side === 'SELL' ? 'sell' : 'buy'}`} onSubmit={submit} data-testid="order-panel">
      <div className="order-head">
        <div className="strong">{bySymbol[symbol]?.name}</div>
        <div className="muted small">
          NSE {formatINR(ltp)}
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
            onClick={() => {
              setSide(s);
              setResult(null);
            }}
            data-testid={`side-${s.toLowerCase()}`}
          >
            {s === 'BUY' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      <div className="order-body">
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

        <label className="field">
          <span>Qty</span>
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
          <span>Price</span>
          <div className="price-row">
            <div className="chip-group compact" role="radiogroup" aria-label="Order type">
              {(['MARKET', 'LIMIT'] as OrderType[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  role="radio"
                  aria-checked={orderType === t}
                  className={`chip ${orderType === t ? 'active' : ''}`}
                  onClick={() => switchType(t)}
                  data-testid={`ordertype-${t.toLowerCase()}`}
                >
                  {t === 'MARKET' ? 'Market' : 'Limit'}
                </button>
              ))}
            </div>
            {orderType === 'LIMIT' ? (
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
          </div>
        </div>

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
              Holding: <b data-testid="order-holding">{held} shares</b>
              {sellable < held && <span className="muted"> ({sellable} free)</span>}
            </span>
          )}
          <span>
            Approx req.: <b data-testid="order-approx">{formatPaise(approxPaise)}</b>
          </span>
        </div>
        {insufficient && (
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
  );
}
