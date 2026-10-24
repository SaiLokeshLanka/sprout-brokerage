import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { api, errorMessage, getAccessToken, refreshSession } from '../api/client';
import { formatINR } from '../utils/format';
import { useWallet } from '../wallet/WalletContext';

/**
 * Trading state from the server's Order Management System:
 * orders (GET /api/orders), GTTs (GET /api/gtt), stock holdings + realised P&L
 * (GET /api/portfolio/holdings), live order and GTT updates over the private WebSocket namespace /account.
 * Option positions have their own page section (they need live option premiums from the server).
 *
 * Every rule (funds, holdings, market hours, prices) is enforced by the server.
 * Only the watchlist is kept in this browser.
 */

export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL_M';
export type Product = 'DELIVERY' | 'INTRADAY';
export type OrderStatus = 'TRIGGER_PENDING' | 'OPEN' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED';
export type GttStatus = 'ACTIVE' | 'TRIGGERED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

/** Waiting orders: limit orders for their price, stop-loss orders for their trigger. */
export const isWaiting = (o: { status: OrderStatus }) => o.status === 'OPEN' || o.status === 'TRIGGER_PENDING';

/** An order with prices in rupees, for the UI. */
export interface Order {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  orderType: OrderType;
  product: Product;
  limitPrice?: number;
  triggerPrice?: number;
  status: OrderStatus;
  fillPrice?: number;
  blockedPaise: number;
  chargesPaise: number;
  reason?: string;
  createdAt: number;
  updatedAt: number;
}

/** A Good Till Triggered instruction, prices in rupees. */
export interface Gtt {
  id: string;
  symbol: string;
  side: Side;
  kind: 'SINGLE' | 'OCO';
  qty: number;
  trigger: number;
  limit: number;
  stopTrigger?: number;
  stopLimit?: number;
  status: GttStatus;
  triggeredLeg?: 'SINGLE' | 'TARGET' | 'STOPLOSS';
  orderId?: string;
  reason?: string;
  expiresAt: number;
  createdAt: number;
}

export interface CreateGttInput {
  symbol: string;
  side: Side;
  kind: 'SINGLE' | 'OCO';
  qty: number;
  /** Rupees. OCO: the target leg. */
  trigger: number;
  limit: number;
  stopTrigger?: number;
  stopLimit?: number;
}

export interface Holding {
  symbol: string;
  qty: number;
  /** Shares promised to open sell orders. */
  reservedQty: number;
  avgPrice: number;
  /**
   * Rupees. What the holding was "worth" at the start of today: shares held from before
   * at yesterday's close, shares bought today at their buy price. Day's P&L = qty × ltp − dayBasis.
   */
  dayBasis: number;
}

export interface TradeState {
  orders: Order[];
  gtts: Gtt[];
  holdings: Record<string, Holding>;
  realizedPaise: number;
  realizedTodayPaise: number;
  watchlist: string[];
}

export interface PlaceOrderInput {
  symbol: string;
  side: Side;
  qty: number;
  orderType: OrderType;
  product: Product;
  /** Rupees. LIMIT and SL orders. */
  limitPrice?: number;
  /** Rupees. SL and SL_M orders. */
  triggerPrice?: number;
}

export interface PlaceOrderResult {
  ok: boolean;
  message: string;
  order?: Order;
}

interface ServerOrder {
  id: string;
  symbol: string;
  side: Side;
  orderType: OrderType;
  product: Product;
  qty: number;
  limitPricePaise: number | null;
  triggerPricePaise: number | null;
  status: OrderStatus;
  fillPricePaise: number | null;
  blockedPaise: number;
  chargesPaise: number;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ServerGtt {
  id: string;
  symbol: string;
  side: Side;
  kind: 'SINGLE' | 'OCO';
  qty: number;
  triggerPricePaise: number;
  limitPricePaise: number;
  stopTriggerPricePaise: number | null;
  stopLimitPricePaise: number | null;
  status: GttStatus;
  triggeredLeg: Gtt['triggeredLeg'] | null;
  orderId: string | null;
  statusReason: string | null;
  expiresAt: string;
  createdAt: string;
}

interface HoldingsResponse {
  holdings: { symbol: string; segment: 'EQUITY' | 'OPTIONS'; qty: number; reservedQty: number; avgPricePaise: number; dayBasisPaise: number }[];
  realizedPnlPaise: number;
  realizedTodayPaise: number;
}

const toOrder = (o: ServerOrder): Order => ({
  id: o.id,
  symbol: o.symbol,
  side: o.side,
  qty: o.qty,
  orderType: o.orderType,
  product: o.product,
  limitPrice: o.limitPricePaise === null ? undefined : o.limitPricePaise / 100,
  triggerPrice: o.triggerPricePaise === null ? undefined : o.triggerPricePaise / 100,
  status: o.status,
  fillPrice: o.fillPricePaise === null ? undefined : o.fillPricePaise / 100,
  blockedPaise: o.blockedPaise,
  chargesPaise: o.chargesPaise,
  reason: o.statusReason ?? undefined,
  createdAt: Date.parse(o.createdAt),
  updatedAt: Date.parse(o.updatedAt),
});

const toGtt = (g: ServerGtt): Gtt => ({
  id: g.id,
  symbol: g.symbol,
  side: g.side,
  kind: g.kind,
  qty: g.qty,
  trigger: g.triggerPricePaise / 100,
  limit: g.limitPricePaise / 100,
  stopTrigger: g.stopTriggerPricePaise === null ? undefined : g.stopTriggerPricePaise / 100,
  stopLimit: g.stopLimitPricePaise === null ? undefined : g.stopLimitPricePaise / 100,
  status: g.status,
  triggeredLeg: g.triggeredLeg ?? undefined,
  orderId: g.orderId ?? undefined,
  reason: g.statusReason ?? undefined,
  expiresAt: Date.parse(g.expiresAt),
  createdAt: Date.parse(g.createdAt),
});

const paise = (rupees: number) => Math.round(rupees * 100);

// ───────────────────────── Watchlist (browser only) ─────────────────────────

const watchlistKey = (userId: string) => `sprout.watchlist.${userId}`;
const DEFAULT_WATCHLIST = ['RELIANCE', 'TCS', 'INFY', 'ZOMATO'];

function loadWatchlist(userId: string): string[] {
  try {
    const saved = localStorage.getItem(watchlistKey(userId));
    if (saved) return JSON.parse(saved);
    // Carry over the watchlist from the old browser-only trading state (before Phase 3).
    const legacy = localStorage.getItem(`sprout.trade.v2.${userId}`);
    if (legacy) return JSON.parse(legacy).watchlist ?? DEFAULT_WATCHLIST;
  } catch {
    // storage unavailable
  }
  return DEFAULT_WATCHLIST;
}

// ───────────────────────────── Context ─────────────────────────────

interface TradeContextValue {
  state: TradeState;
  /** True once orders and holdings have loaded the first time. */
  loaded: boolean;
  /** Free cash in the wallet (the server already excludes money blocked by open orders). */
  availablePaise: number;
  blockedPaise: number;
  placeOrder: (input: PlaceOrderInput) => Promise<PlaceOrderResult>;
  cancelOrder: (id: string) => Promise<{ ok: boolean; message: string }>;
  createGtt: (input: CreateGttInput) => Promise<{ ok: boolean; message: string }>;
  cancelGtt: (id: string) => Promise<{ ok: boolean; message: string }>;
  toggleWatchlist: (symbol: string) => void;
  refresh: () => Promise<void>;
}

const TradeContext = createContext<TradeContextValue | null>(null);

export function TradeProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { balancePaise, blockedPaise, refresh: refreshWallet } = useWallet();
  const [orders, setOrders] = useState<Order[]>([]);
  const [gtts, setGtts] = useState<Gtt[]>([]);
  const [holdings, setHoldings] = useState<Record<string, Holding>>({});
  const [realizedPaise, setRealizedPaise] = useState(0);
  const [realizedTodayPaise, setRealizedTodayPaise] = useState(0);
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist(userId));
  const [loaded, setLoaded] = useState(false);

  const loadOrders = useCallback(async () => {
    const list = await api.get<ServerOrder[]>('/orders?limit=200');
    setOrders(list.map(toOrder));
  }, []);

  const loadGtts = useCallback(async () => {
    const list = await api.get<ServerGtt[]>('/gtt');
    setGtts(list.map(toGtt));
  }, []);

  const loadHoldings = useCallback(async () => {
    const res = await api.get<HoldingsResponse>('/portfolio/holdings');
    setHoldings(
      Object.fromEntries(
        res.holdings.filter((h) => h.segment === 'EQUITY').map((h) => [
          h.symbol,
          { symbol: h.symbol, qty: h.qty, reservedQty: h.reservedQty, avgPrice: h.avgPricePaise / 100, dayBasis: h.dayBasisPaise / 100 },
        ]),
      ),
    );
    setRealizedPaise(res.realizedPnlPaise);
    setRealizedTodayPaise(res.realizedTodayPaise);
  }, []);

  /** After anything changes money or shares: reload holdings and wallet. */
  const syncAfterChange = useCallback(() => {
    loadHoldings().catch(() => undefined);
    refreshWallet().catch(() => undefined);
  }, [loadHoldings, refreshWallet]);

  const refresh = useCallback(async () => {
    await Promise.all([loadOrders(), loadGtts(), loadHoldings(), refreshWallet()]);
  }, [loadOrders, loadGtts, loadHoldings, refreshWallet]);

  useEffect(() => {
    refresh()
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [refresh]);

  const upsertOrder = useCallback((order: Order) => {
    setOrders((prev) => (prev.some((o) => o.id === order.id) ? prev.map((o) => (o.id === order.id ? order : o)) : [order, ...prev]));
  }, []);

  const upsertGtt = useCallback((gtt: Gtt) => {
    setGtts((prev) => (prev.some((g) => g.id === gtt.id) ? prev.map((g) => (g.id === gtt.id ? gtt : g)) : [gtt, ...prev]));
  }, []);

  // Live updates: limit orders can fill or expire while you're on any page (or away).
  useEffect(() => {
    const socket = io('/account', {
      transports: ['websocket'],
      // A function, so every (re)connect sends the current token — it rotates every 15 minutes.
      auth: (cb) => cb({ token: getAccessToken() ?? '' }),
    });
    socket.on('order', (o: ServerOrder) => {
      upsertOrder(toOrder(o));
      syncAfterChange();
    });
    socket.on('gtt', (g: ServerGtt) => upsertGtt(toGtt(g)));
    // The server drops sockets with an expired token; renew the session, then reconnect.
    socket.on('auth_error', async () => {
      if (await refreshSession()) socket.connect();
    });
    return () => {
      socket.close();
    };
  }, [upsertOrder, upsertGtt, syncAfterChange]);

  useEffect(() => {
    try {
      localStorage.setItem(watchlistKey(userId), JSON.stringify(watchlist));
    } catch {
      // storage unavailable
    }
  }, [watchlist, userId]);

  const placeOrder = useCallback(
    async (input: PlaceOrderInput): Promise<PlaceOrderResult> => {
      // Quick checks for instant feedback; the server validates everything again.
      if (!Number.isInteger(input.qty) || input.qty <= 0) {
        return { ok: false, message: 'Quantity must be a whole number greater than 0' };
      }
      const needsLimit = input.orderType === 'LIMIT' || input.orderType === 'SL';
      const needsTrigger = input.orderType === 'SL' || input.orderType === 'SL_M';
      if (needsLimit && !(input.limitPrice && input.limitPrice > 0)) {
        return { ok: false, message: 'Enter a valid limit price' };
      }
      if (needsTrigger && !(input.triggerPrice && input.triggerPrice > 0)) {
        return { ok: false, message: 'Enter a valid trigger price' };
      }
      try {
        const order = toOrder(
          await api.post<ServerOrder>(
            '/orders',
            {
              symbol: input.symbol,
              side: input.side,
              orderType: input.orderType,
              product: input.product,
              qty: input.qty,
              ...(needsLimit ? { limitPricePaise: paise(input.limitPrice!) } : {}),
              ...(needsTrigger ? { triggerPricePaise: paise(input.triggerPrice!) } : {}),
            },
            { headers: { 'Idempotency-Key': crypto.randomUUID() } },
          ),
        );
        upsertOrder(order);
        syncAfterChange();
        if (order.status === 'REJECTED') return { ok: false, order, message: `Order rejected: ${order.reason}` };
        if (order.status === 'EXECUTED') {
          const verb = order.side === 'BUY' ? 'Bought' : 'Sold';
          return { ok: true, order, message: `${verb} ${order.qty} × ${order.symbol} @ ${formatINR(order.fillPrice!)}` };
        }
        if (order.status === 'TRIGGER_PENDING') {
          const towards = order.side === 'BUY' ? 'rises to' : 'falls to';
          return { ok: true, order, message: `Stop-loss order placed. Triggers when price ${towards} ${formatINR(order.triggerPrice!)}` };
        }
        const direction = order.side === 'BUY' ? 'falls to' : 'rises to';
        return { ok: true, order, message: `Limit order placed. Executes when price ${direction} ${formatINR(order.limitPrice!)}` };
      } catch (err) {
        return { ok: false, message: errorMessage(err) };
      }
    },
    [upsertOrder, syncAfterChange],
  );

  const cancelOrder = useCallback(
    async (id: string) => {
      try {
        upsertOrder(toOrder(await api.delete<ServerOrder>(`/orders/${id}`)));
        syncAfterChange();
        return { ok: true, message: 'Order cancelled' };
      } catch (err) {
        loadOrders().catch(() => undefined); // it may have executed meanwhile
        return { ok: false, message: errorMessage(err) };
      }
    },
    [upsertOrder, syncAfterChange, loadOrders],
  );

  const createGtt = useCallback(
    async (input: CreateGttInput) => {
      if (!Number.isInteger(input.qty) || input.qty <= 0) return { ok: false, message: 'Quantity must be a whole number greater than 0' };
      try {
        const gtt = toGtt(
          await api.post<ServerGtt>('/gtt', {
            symbol: input.symbol,
            side: input.side,
            kind: input.kind,
            qty: input.qty,
            triggerPricePaise: paise(input.trigger),
            limitPricePaise: paise(input.limit),
            ...(input.kind === 'OCO' ? { stopTriggerPricePaise: paise(input.stopTrigger ?? 0), stopLimitPricePaise: paise(input.stopLimit ?? 0) } : {}),
          }),
        );
        upsertGtt(gtt);
        return { ok: true, message: `GTT created. It stays active for a year until ${input.kind === 'OCO' ? 'a trigger' : 'the trigger'} is reached.` };
      } catch (err) {
        return { ok: false, message: errorMessage(err) };
      }
    },
    [upsertGtt],
  );

  const cancelGtt = useCallback(
    async (id: string) => {
      try {
        upsertGtt(toGtt(await api.delete<ServerGtt>(`/gtt/${id}`)));
        return { ok: true, message: 'GTT cancelled' };
      } catch (err) {
        loadGtts().catch(() => undefined);
        return { ok: false, message: errorMessage(err) };
      }
    },
    [upsertGtt, loadGtts],
  );

  const toggleWatchlist = useCallback((symbol: string) => {
    setWatchlist((list) => (list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol]));
  }, []);

  const value = useMemo<TradeContextValue>(
    () => ({
      state: { orders, gtts, holdings, realizedPaise, realizedTodayPaise, watchlist },
      loaded,
      availablePaise: balancePaise ?? 0,
      blockedPaise,
      placeOrder,
      cancelOrder,
      createGtt,
      cancelGtt,
      toggleWatchlist,
      refresh,
    }),
    [orders, gtts, holdings, realizedPaise, realizedTodayPaise, watchlist, loaded, balancePaise, blockedPaise, placeOrder, cancelOrder, createGtt, cancelGtt, toggleWatchlist, refresh],
  );

  return <TradeContext.Provider value={value}>{children}</TradeContext.Provider>;
}

export function useTrade(): TradeContextValue {
  const ctx = useContext(TradeContext);
  if (!ctx) throw new Error('useTrade must be used inside <TradeProvider>');
  return ctx;
}
