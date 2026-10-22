import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMarket } from '../market/MarketContext';
import { formatINR, roundToTick, toPaise } from '../utils/format';
import { useWallet } from '../wallet/WalletContext';

/**
 * Paper-trading account: holdings, orders and a tiny matching engine.
 *
 * Cash comes from the REAL backend wallet. Trades are still simulated in the
 * browser (until the Phase 3 order service), so their net cash effect is tracked
 * here as tradeCashDeltaPaise and applied on top of the wallet balance.
 */

export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type Product = 'DELIVERY' | 'INTRADAY';
export type OrderStatus = 'OPEN' | 'EXECUTED' | 'CANCELLED' | 'REJECTED';

export interface Order {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  orderType: OrderType;
  product: Product;
  limitPrice?: number;
  status: OrderStatus;
  fillPrice?: number;
  blockedPaise: number;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Holding {
  symbol: string;
  qty: number;
  avgPrice: number;
}

export interface TradeState {
  /** Net cash spent (−) or received (+) by simulated trades, applied on top of the wallet. */
  tradeCashDeltaPaise: number;
  realizedPaise: number;
  holdings: Record<string, Holding>;
  orders: Order[];
  watchlist: string[];
}

export interface PlaceOrderInput {
  symbol: string;
  side: Side;
  qty: number;
  orderType: OrderType;
  product: Product;
  limitPrice?: number;
}

export interface PlaceOrderResult {
  ok: boolean;
  message: string;
  order?: Order;
}

/** Each user gets their own simulated portfolio in this browser. */
const storageKey = (userId: string) => `sprout.trade.v2.${userId}`;

const defaultState = (): TradeState => ({
  tradeCashDeltaPaise: 0,
  realizedPaise: 0,
  holdings: {},
  orders: [],
  watchlist: ['RELIANCE', 'TCS', 'INFY', 'ZOMATO'],
});

function loadState(userId: string): TradeState {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    // storage unavailable — start fresh
  }
  return defaultState();
}

const newOrderId = () =>
  `ORD${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const blockedPaiseOf = (s: TradeState) =>
  s.orders.reduce((sum, o) => (o.status === 'OPEN' ? sum + o.blockedPaise : sum), 0);

const isMarketable = (o: Pick<Order, 'side' | 'orderType' | 'limitPrice'>, ltp: number) => {
  if (o.orderType === 'MARKET') return true;
  return o.side === 'BUY' ? ltp <= o.limitPrice! : ltp >= o.limitPrice!;
};

const upsertOrder = (orders: Order[], order: Order) =>
  orders.some((o) => o.id === order.id) ? orders.map((o) => (o.id === order.id ? order : o)) : [order, ...orders];

function applyFill(s: TradeState, order: Order, fillPrice: number): TradeState {
  const now = Date.now();
  const value = toPaise(fillPrice) * order.qty;
  const holdings = { ...s.holdings };
  const held = holdings[order.symbol];
  let { tradeCashDeltaPaise, realizedPaise } = s;

  if (order.side === 'BUY') {
    tradeCashDeltaPaise -= value;
    const qty = (held?.qty ?? 0) + order.qty;
    const avgPrice = held ? (held.avgPrice * held.qty + fillPrice * order.qty) / qty : fillPrice;
    holdings[order.symbol] = { symbol: order.symbol, qty, avgPrice };
  } else {
    if (!held || held.qty < order.qty) {
      const rejected: Order = { ...order, status: 'REJECTED', reason: 'Insufficient holdings', blockedPaise: 0, updatedAt: now };
      return { ...s, orders: upsertOrder(s.orders, rejected) };
    }
    tradeCashDeltaPaise += value;
    realizedPaise += Math.round((fillPrice - held.avgPrice) * 100 * order.qty);
    const qty = held.qty - order.qty;
    if (qty > 0) holdings[order.symbol] = { ...held, qty };
    else delete holdings[order.symbol];
  }

  const filled: Order = { ...order, status: 'EXECUTED', fillPrice, blockedPaise: 0, updatedAt: now };
  return { ...s, tradeCashDeltaPaise, realizedPaise, holdings, orders: upsertOrder(s.orders, filled) };
}

interface TradeContextValue {
  state: TradeState;
  /** Wallet balance + simulated trade cash − money blocked by open orders. */
  availablePaise: number;
  blockedPaise: number;
  placeOrder: (input: PlaceOrderInput) => PlaceOrderResult;
  cancelOrder: (id: string) => void;
  toggleWatchlist: (symbol: string) => void;
  /** Clears simulated holdings and orders. The real wallet is not touched. */
  resetAccount: () => void;
}

const TradeContext = createContext<TradeContextValue | null>(null);

export function TradeProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { quotes } = useMarket();
  const { balancePaise: walletPaise } = useWallet();
  const [state, setState] = useState<TradeState>(() => loadState(userId));
  const stateRef = useRef(state);
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const walletRef = useRef(walletPaise ?? 0);
  walletRef.current = walletPaise ?? 0;

  const commit = useCallback((next: TradeState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(state));
    } catch {
      // storage unavailable — state lives in memory only
    }
  }, [state, userId]);

  // Matching engine: on every tick, fill open limit orders whose price was reached.
  useEffect(() => {
    let s = stateRef.current;
    let changed = false;
    for (const o of s.orders) {
      if (o.status !== 'OPEN') continue;
      const q = quotes[o.symbol];
      if (q && isMarketable(o, q.ltp)) {
        s = applyFill(s, o, q.ltp);
        changed = true;
      }
    }
    if (changed) commit(s);
  }, [quotes, commit]);

  const placeOrder = useCallback(
    (input: PlaceOrderInput): PlaceOrderResult => {
      const s = stateRef.current;
      const q = quotesRef.current[input.symbol];
      if (!q) return { ok: false, message: 'Unknown instrument' };
      if (!Number.isInteger(input.qty) || input.qty <= 0) {
        return { ok: false, message: 'Quantity must be a whole number greater than 0' };
      }
      if (input.orderType === 'LIMIT' && !(input.limitPrice && input.limitPrice > 0)) {
        return { ok: false, message: 'Enter a valid limit price' };
      }

      const now = Date.now();
      const order: Order = {
        ...input,
        id: newOrderId(),
        limitPrice: input.orderType === 'LIMIT' ? roundToTick(input.limitPrice!) : undefined,
        status: 'OPEN',
        blockedPaise: 0,
        createdAt: now,
        updatedAt: now,
      };
      const reject = (reason: string): PlaceOrderResult => {
        const rejected: Order = { ...order, status: 'REJECTED', reason };
        commit({ ...s, orders: [rejected, ...s.orders] });
        return { ok: false, message: `Order rejected: ${reason}`, order: rejected };
      };

      const refPrice = order.orderType === 'MARKET' ? q.ltp : order.limitPrice!;
      let blocked = 0;
      if (order.side === 'BUY') {
        blocked = toPaise(refPrice) * order.qty;
        if (blocked > walletRef.current + s.tradeCashDeltaPaise - blockedPaiseOf(s)) return reject('Insufficient funds');
      } else {
        const held = s.holdings[order.symbol]?.qty ?? 0;
        const reserved = s.orders
          .filter((o) => o.status === 'OPEN' && o.side === 'SELL' && o.symbol === order.symbol)
          .reduce((sum, o) => sum + o.qty, 0);
        const sellable = held - reserved;
        if (order.qty > sellable) {
          return reject(held === 0 ? "You don't hold this stock" : `You can sell at most ${sellable} shares`);
        }
      }

      if (isMarketable(order, q.ltp)) {
        const next = applyFill(s, order, q.ltp);
        commit(next);
        const filled = next.orders[0];
        const verb = order.side === 'BUY' ? 'Bought' : 'Sold';
        return { ok: true, order: filled, message: `${verb} ${order.qty} × ${order.symbol} @ ${formatINR(q.ltp)}` };
      }

      const open: Order = { ...order, blockedPaise: order.side === 'BUY' ? blocked : 0 };
      commit({ ...s, orders: [open, ...s.orders] });
      return {
        ok: true,
        order: open,
        message: `Limit order placed. Executes when price ${order.side === 'BUY' ? 'falls to' : 'rises to'} ${formatINR(order.limitPrice!)}`,
      };
    },
    [commit],
  );

  const cancelOrder = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const o = s.orders.find((x) => x.id === id);
      if (!o || o.status !== 'OPEN') return;
      commit({ ...s, orders: upsertOrder(s.orders, { ...o, status: 'CANCELLED', blockedPaise: 0, updatedAt: Date.now() }) });
    },
    [commit],
  );

  const value = useMemo<TradeContextValue>(() => {
    const blockedPaise = blockedPaiseOf(state);
    return {
      state,
      blockedPaise,
      availablePaise: (walletPaise ?? 0) + state.tradeCashDeltaPaise - blockedPaise,
      placeOrder,
      cancelOrder,
      toggleWatchlist: (symbol) => {
        const s = stateRef.current;
        const watchlist = s.watchlist.includes(symbol) ? s.watchlist.filter((x) => x !== symbol) : [...s.watchlist, symbol];
        commit({ ...s, watchlist });
      },
      resetAccount: () => {
        const s = stateRef.current;
        commit({ ...defaultState(), watchlist: s.watchlist });
      },
    };
  }, [state, walletPaise, placeOrder, cancelOrder, commit]);

  return <TradeContext.Provider value={value}>{children}</TradeContext.Provider>;
}

export function useTrade(): TradeContextValue {
  const ctx = useContext(TradeContext);
  if (!ctx) throw new Error('useTrade must be used inside <TradeProvider>');
  return ctx;
}
