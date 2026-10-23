import { Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { istParts, MarketMode, NSE_CLOSE_MINUTE, NSE_OPEN_MINUTE, sessionState } from './market-clock';
import { Candle, ChartRange, MarketStatus, Quote, QUOTES_KEY, STATUS_CHANNEL, TICKS_CHANNEL } from './market.types';
import { hashString, mulberry32 } from './random';

interface SimInstrument {
  symbol: string;
  type: 'EQUITY' | 'INDEX';
  tickPaise: number;
  refPricePaise: number;
}

const CIRCUIT_LIMIT = 0.1; // ±10% band around previous close (equities only)
const TICK_VOLATILITY = { EQUITY: 0.001, INDEX: 0.0005 } as const; // max ±0.1% / ±0.05% per tick
const INSTRUMENT_SYNC_MS = 60_000; // pick up stocks added/removed/edited in the DB
const MAX_MINUTE_CANDLES = 1_000;
const ALWAYS_MODE_HISTORY_MINUTES = 300; // synthetic intraday history shown on startup
const WARN_EVERY_MS = 30_000;

/** Synthetic history shape per chart range (anything longer than today). */
const HISTORY_RANGES: Record<Exclude<ChartRange, '1D'>, { points: number; stepSec: number; vol: number; drift: number }> = {
  '1W': { points: 125, stepSec: 900, vol: 0.004, drift: 0.04 },
  '1M': { points: 120, stepSec: 21_600, vol: 0.006, drift: 0.08 },
  '1Y': { points: 250, stepSec: 86_400, vol: 0.012, drift: 0.3 },
  '5Y': { points: 260, stepSec: 604_800, vol: 0.03, drift: 1.2 },
};

/**
 * The single source of market prices. Every tick it moves each price a little,
 * then publishes ALL quotes to Redis: a hash with the latest quotes (read by the
 * REST API) and a pub/sub message (relayed to browsers by the WebSocket gateway).
 *
 * It never talks to browsers directly, so more API servers could be added later
 * and they would all serve the same prices from Redis.
 */
@Injectable()
export class MarketSimulatorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketSimulatorService.name);
  private readonly instruments = new Map<string, SimInstrument>();
  private readonly quotes = new Map<string, Quote>();
  private readonly minuteCandles = new Map<string, Candle[]>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private paused = false;
  private sessionOverride: boolean | null = null;
  private tradingDay = '';
  private lastInstrumentSync = 0;
  private lastPublishedOpen: boolean | null = null;
  private lastWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private get mode(): MarketMode {
    return this.config.get('MARKET_MODE') === 'nse' ? 'nse' : 'always';
  }

  async onApplicationBootstrap() {
    this.tradingDay = istParts().date;
    await this.syncInstruments();
    const tickMs = Number(this.config.get('MARKET_TICK_MS', 1000));
    this.timer = setInterval(() => void this.tick(), tickMs);
    this.logger.log(`Simulating ${this.quotes.size} instruments every ${tickMs}ms (mode: ${this.mode})`);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ───────────────────────────── Public API ─────────────────────────────

  status(): MarketStatus {
    const base =
      this.sessionOverride === null
        ? sessionState(this.mode)
        : { open: this.sessionOverride, reason: this.sessionOverride ? 'Opened by test hook' : 'Closed by test hook' };
    return { ...base, mode: this.mode, paused: this.paused, serverTime: new Date().toISOString() };
  }

  /** Chart points (t = unix seconds, v = price in paise). 1D uses real minute candles. */
  candles(symbol: string, range: ChartRange) {
    const quote = this.quotes.get(symbol);
    const inst = this.instruments.get(symbol);
    if (!quote || !inst) throw new NotFoundException(`No market data for ${symbol}`);

    if (range === '1D') {
      const points = (this.minuteCandles.get(symbol) ?? []).map((c) => ({ t: c.t, v: c.c }));
      return { symbol, range, points };
    }

    const { points, stepSec, vol, drift } = HISTORY_RANGES[range];
    const rnd = mulberry32(hashString(`${symbol}:${range}`));
    const end = quote.ltpPaise;
    const start = end / (1 + (rnd() - 0.35) * drift);
    const walk = this.randomWalk(points, vol, rnd);
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      symbol,
      range,
      points: walk.map((w, i) => ({
        t: nowSec - (points - 1 - i) * stepSec,
        v: this.roundToTick(inst, this.bridge(start, end, walk, i)),
      })),
    };
  }

  // ───────────────────────────── Test hooks ─────────────────────────────

  async setPaused(paused: boolean) {
    this.paused = paused;
    await this.publishStatus();
    return this.status();
  }

  async setSessionOverride(open: boolean | null) {
    this.sessionOverride = open;
    await this.publishStatus();
    return this.status();
  }

  /** Sets a price immediately (still rounded to tick size and kept within circuit limits). */
  async setPrice(symbol: string, rupees: number) {
    const quote = this.quotes.get(symbol);
    const inst = this.instruments.get(symbol);
    if (!quote || !inst) throw new NotFoundException(`No market data for ${symbol}`);
    this.applyPrice(inst, quote, rupees * 100, 0);
    await this.publishAll();
    return quote;
  }

  // ───────────────────────────── Tick loop ─────────────────────────────

  private async tick() {
    if (this.ticking) return; // never overlap ticks if Redis/DB is slow
    this.ticking = true;
    try {
      if (Date.now() - this.lastInstrumentSync > INSTRUMENT_SYNC_MS) await this.syncInstruments();

      const today = istParts().date;
      if (today !== this.tradingDay) await this.rollover(today);

      const status = this.status();
      if (status.open !== this.lastPublishedOpen) {
        this.lastPublishedOpen = status.open;
        await this.publishStatus();
      }
      if (!status.open || this.paused) return;

      for (const quote of this.quotes.values()) {
        const inst = this.instruments.get(quote.symbol)!;
        const move = (Math.random() - 0.5) * 2 * TICK_VOLATILITY[inst.type];
        this.applyPrice(inst, quote, quote.ltpPaise * (1 + move), Math.floor(Math.random() * 2_000));
      }
      await this.publishAll();
    } catch (err) {
      this.warnThrottled(`Tick failed: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private applyPrice(inst: SimInstrument, quote: Quote, rawPaise: number, addVolume: number) {
    const ltp = this.clampToCircuit(inst, quote, this.roundToTick(inst, rawPaise));
    quote.ltpPaise = ltp;
    quote.highPaise = Math.max(quote.highPaise, ltp);
    quote.lowPaise = Math.min(quote.lowPaise, ltp);
    quote.volume += addVolume;
    quote.updatedAt = Date.now();
    this.recordCandle(quote.symbol, ltp);
  }

  private recordCandle(symbol: string, price: number) {
    const minute = Math.floor(Date.now() / 60_000) * 60;
    const candles = this.minuteCandles.get(symbol) ?? [];
    const last = candles[candles.length - 1];
    if (last && last.t === minute) {
      last.h = Math.max(last.h, price);
      last.l = Math.min(last.l, price);
      last.c = price;
    } else {
      candles.push({ t: minute, o: last?.c ?? price, h: price, l: price, c: price });
      if (candles.length > MAX_MINUTE_CANDLES) candles.shift();
    }
    this.minuteCandles.set(symbol, candles);
  }

  // ─────────────────────── Instruments & trading days ───────────────────────

  /** Loads active instruments from Postgres. New ones start trading; deactivated ones stop. */
  private async syncInstruments() {
    this.lastInstrumentSync = Date.now();
    let rows;
    try {
      rows = await this.prisma.instrument.findMany({
        where: { isActive: true },
        select: { symbol: true, type: true, tickSizePaise: true, refPricePaise: true },
      });
    } catch (err) {
      this.warnThrottled(`Could not load instruments (${(err as Error).message.split('\n').pop()}); will retry`);
      this.lastInstrumentSync = Date.now() - INSTRUMENT_SYNC_MS + 5_000; // retry in ~5s
      return;
    }

    const active = new Set<string>();
    for (const r of rows) {
      active.add(r.symbol);
      const inst: SimInstrument = { symbol: r.symbol, type: r.type, tickPaise: r.tickSizePaise, refPricePaise: r.refPricePaise };
      this.instruments.set(r.symbol, inst);
      if (!this.quotes.has(r.symbol)) this.initQuote(inst);
    }
    for (const symbol of [...this.quotes.keys()]) {
      if (active.has(symbol)) continue;
      this.quotes.delete(symbol);
      this.instruments.delete(symbol);
      this.minuteCandles.delete(symbol);
    }
  }

  /** Starts an instrument's day: seeded opening move plus synthetic history for the earlier part of the day. */
  private initQuote(inst: SimInstrument) {
    const rnd = mulberry32(hashString(`${inst.symbol}:${this.tradingDay}`));
    const prev = inst.refPricePaise;
    const quote: Quote = {
      symbol: inst.symbol,
      prevClosePaise: prev,
      openPaise: 0,
      ltpPaise: 0,
      highPaise: 0,
      lowPaise: 0,
      ...this.circuitFor(inst, prev),
      volume: Math.floor(rnd() * 5_000_000) + 200_000,
      updatedAt: Date.now(),
    };
    const open = this.clampToCircuit(inst, quote, this.roundToTick(inst, prev * (1 + (rnd() - 0.5) * 0.01)));
    const ltp = this.clampToCircuit(inst, quote, this.roundToTick(inst, prev * (1 + (rnd() - 0.5) * 0.06)));
    const candles = this.syntheticIntraday(inst, quote, open, ltp, rnd);

    quote.openPaise = open;
    quote.ltpPaise = ltp;
    quote.highPaise = Math.max(open, ltp, ...candles.map((c) => c.h));
    quote.lowPaise = Math.min(open, ltp, ...candles.map((c) => c.l));
    this.quotes.set(inst.symbol, quote);
    this.minuteCandles.set(inst.symbol, candles);
  }

  private syntheticIntraday(inst: SimInstrument, quote: Quote, open: number, ltp: number, rnd: () => number): Candle[] {
    const thisMinute = Math.floor(Date.now() / 60_000) * 60;
    let start: number;
    let end = thisMinute - 60;
    if (this.mode === 'always') {
      start = end - (ALWAYS_MODE_HISTORY_MINUTES - 1) * 60;
    } else {
      const { minuteOfDay, weekday } = istParts();
      if (weekday === 0 || weekday === 6 || minuteOfDay < NSE_OPEN_MINUTE) return [];
      start = thisMinute - (minuteOfDay - NSE_OPEN_MINUTE) * 60;
      end = Math.min(end, start + (NSE_CLOSE_MINUTE - NSE_OPEN_MINUTE - 1) * 60);
    }
    const count = Math.floor((end - start) / 60) + 1;
    if (count < 2) return [];

    const walk = this.randomWalk(count, 0.002, rnd);
    const candles: Candle[] = [];
    let prevClose = open;
    for (let i = 0; i < count; i++) {
      const c = this.clampToCircuit(inst, quote, this.roundToTick(inst, this.bridge(open, ltp, walk, i)));
      candles.push({ t: start + i * 60, o: prevClose, h: Math.max(prevClose, c), l: Math.min(prevClose, c), c });
      prevClose = c;
    }
    return candles;
  }

  /** New IST day: yesterday's last price becomes the previous close, and is saved to the DB. */
  private async rollover(day: string) {
    this.logger.log(`New trading day ${day}`);
    this.tradingDay = day;
    const closes = [...this.quotes.values()].map((q) => ({ symbol: q.symbol, close: q.ltpPaise }));
    for (const quote of this.quotes.values()) {
      const inst = this.instruments.get(quote.symbol)!;
      const close = quote.ltpPaise;
      Object.assign(quote, {
        prevClosePaise: close,
        openPaise: close,
        highPaise: close,
        lowPaise: close,
        volume: 0,
        updatedAt: Date.now(),
        ...this.circuitFor(inst, close),
      });
      inst.refPricePaise = close;
      this.minuteCandles.set(quote.symbol, []);
    }
    try {
      await this.prisma.$transaction(
        closes.map((c) => this.prisma.instrument.updateMany({ where: { symbol: c.symbol }, data: { refPricePaise: c.close } })),
      );
    } catch (err) {
      this.warnThrottled(`Could not save closing prices: ${(err as Error).message}`);
    }
  }

  // ───────────────────────────── Publishing ─────────────────────────────

  /** Atomically replaces the quotes hash and broadcasts the tick. */
  private async publishAll() {
    if (this.redis.status !== 'ready') return this.warnThrottled('Redis not connected — prices are not being published');
    const quotes = [...this.quotes.values()];
    const multi = this.redis.multi().del(QUOTES_KEY);
    if (quotes.length) multi.hset(QUOTES_KEY, Object.fromEntries(quotes.map((q) => [q.symbol, JSON.stringify(q)])));
    multi.publish(TICKS_CHANNEL, JSON.stringify(quotes));
    await multi.exec();
  }

  private async publishStatus() {
    if (this.redis.status !== 'ready') return;
    await this.redis.publish(STATUS_CHANNEL, JSON.stringify(this.status()));
  }

  // ───────────────────────────── Price helpers ─────────────────────────────

  private roundToTick(inst: SimInstrument, paise: number) {
    return Math.max(inst.tickPaise, Math.round(paise / inst.tickPaise) * inst.tickPaise);
  }

  private circuitFor(inst: SimInstrument, prevClose: number) {
    if (inst.type === 'INDEX') return { upperCircuitPaise: null, lowerCircuitPaise: null };
    return {
      upperCircuitPaise: Math.floor((prevClose * (1 + CIRCUIT_LIMIT)) / inst.tickPaise) * inst.tickPaise,
      lowerCircuitPaise: Math.ceil((prevClose * (1 - CIRCUIT_LIMIT)) / inst.tickPaise) * inst.tickPaise,
    };
  }

  private clampToCircuit(inst: SimInstrument, quote: Pick<Quote, 'upperCircuitPaise' | 'lowerCircuitPaise'>, paise: number) {
    if (quote.upperCircuitPaise === null || quote.lowerCircuitPaise === null) return paise;
    return Math.min(Math.max(paise, quote.lowerCircuitPaise), quote.upperCircuitPaise);
  }

  private randomWalk(points: number, vol: number, rnd: () => number) {
    const walk = [0];
    for (let i = 1; i < points; i++) walk.push(walk[i - 1] + (rnd() - 0.5) * vol);
    return walk;
  }

  /** A random walk pinned to `start` at the first point and `end` at the last (a Brownian bridge). */
  private bridge(start: number, end: number, walk: number[], i: number) {
    const n = walk.length - 1;
    const t = n === 0 ? 1 : i / n;
    return (start + (end - start) * t) * (1 + walk[i] - walk[n] * t);
  }

  private warnThrottled(message: string) {
    if (Date.now() - this.lastWarnAt < WARN_EVERY_MS) return;
    this.lastWarnAt = Date.now();
    this.logger.warn(message);
  }
}
