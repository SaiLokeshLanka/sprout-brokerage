import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { istParts } from '../market/market-clock';
import { MarketSimulatorService } from '../market/market-simulator.service';
import { hashString, mulberry32 } from '../market/random';
import { blackScholes } from './black-scholes';
import {
  atmStrike,
  CHAIN_STRIKES_EACH_SIDE,
  expiryInstant,
  isExpired,
  listExpiries,
  OptionContract,
  OptionKind,
  optionDisplayName,
  optionSymbol,
  parseOptionSymbol,
  UNDERLYINGS,
} from './option-contract';

/** Yearly risk-free interest rate used for pricing (roughly the Indian T-bill yield). */
export const RISK_FREE_RATE = 0.065;
const TICK_PAISE = 5;
const YEAR_MS = 365 * 86_400_000;

export interface OptionQuote {
  symbol: string;
  name: string;
  underlying: string;
  expiry: string;
  strikePaise: number;
  kind: OptionKind;
  lotSize: number;
  spotPaise: number;
  ltpPaise: number;
  prevClosePaise: number;
  /** Implied volatility in percent, e.g. 13.2 */
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  /** Open interest and today's volume, in units (illustrative, simulated). */
  oi: number;
  volume: number;
  expired: boolean;
}

/** A live price for anything that can be held: a stock or an option contract. */
export interface LivePrice {
  ltpPaise: number;
  prevClosePaise: number;
}

const toTick = (paise: number) => Math.max(TICK_PAISE, Math.round(paise / TICK_PAISE) * TICK_PAISE);
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Prices index options from the simulated index price with Black-Scholes.
 * Nothing is stored: premiums are recalculated whenever they are asked for,
 * so they move with every tick of the underlying index and lose value as expiry nears.
 */
@Injectable()
export class OptionsService {
  constructor(private readonly simulator: MarketSimulatorService) {}

  /** Live price of a stock (from the simulator) or an option (calculated). */
  priceOf(symbol: string): LivePrice | undefined {
    const quote = this.simulator.getQuote(symbol);
    if (quote) return quote;
    const contract = parseOptionSymbol(symbol);
    return contract ? (this.quote(contract) ?? undefined) : undefined;
  }

  underlyings() {
    return Object.values(UNDERLYINGS).map((u) => ({
      symbol: u.symbol,
      name: u.name,
      lotSize: u.lotSize,
      strikeStepPaise: u.strikeStepPaise,
      spotPaise: this.simulator.getQuote(u.symbol)?.ltpPaise ?? null,
      expiries: listExpiries(u),
    }));
  }

  chain(underlying: string, expiry?: string) {
    const cfg = UNDERLYINGS[underlying];
    if (!cfg) throw new NotFoundException(`No options on ${underlying}. Available: ${Object.keys(UNDERLYINGS).join(', ')}`);
    const expiries = listExpiries(cfg);
    const chosen = expiry ?? expiries[0];
    if (!expiries.includes(chosen)) throw new BadRequestException(`expiry must be one of: ${expiries.join(', ')}`);
    const spot = this.simulator.getQuote(underlying);
    if (!spot) throw new ServiceUnavailableException(`No live price for ${underlying} yet`);

    const atm = atmStrike(spot.ltpPaise, cfg.strikeStepPaise);
    const rows = [];
    for (let i = -CHAIN_STRIKES_EACH_SIDE; i <= CHAIN_STRIKES_EACH_SIDE; i++) {
      const strike = atm + i * cfg.strikeStepPaise;
      const contract = (kind: OptionKind) => ({ symbol: optionSymbol(underlying, chosen, strike, kind), underlying, expiry: chosen, strikePaise: strike, kind });
      rows.push({ strikePaise: strike, call: this.quote(contract('CE'))!, put: this.quote(contract('PE'))! });
    }
    const calls = rows.reduce((s, r) => s + r.call.oi, 0);
    const puts = rows.reduce((s, r) => s + r.put.oi, 0);
    return {
      underlying,
      name: cfg.name,
      spotPaise: spot.ltpPaise,
      expiry: chosen,
      expiries,
      lotSize: cfg.lotSize,
      atmStrikePaise: atm,
      daysToExpiry: round((expiryInstant(chosen).getTime() - Date.now()) / 86_400_000, 2),
      /** Put-call ratio of open interest: above 1 = more puts than calls outstanding. */
      pcr: calls ? round(puts / calls, 2) : null,
      rows,
    };
  }

  /** Quote for one contract; null if its underlying has no price yet. */
  quote(c: OptionContract, now = new Date()): OptionQuote | null {
    const cfg = UNDERLYINGS[c.underlying];
    const spot = this.simulator.getQuote(c.underlying);
    if (!cfg || !spot) return null;

    const years = (expiryInstant(c.expiry).getTime() - now.getTime()) / YEAR_MS;
    const expired = isExpired(c, now);
    const live = this.fairValue(c, spot.ltpPaise, years);
    // Yesterday's close: yesterday's index close, one day further from expiry.
    const prev = this.fairValue(c, spot.prevClosePaise, years + 1 / 365);

    // Simulated open interest, highest near the money; stable through the day.
    const rnd = mulberry32(hashString(`${c.symbol}:${istParts(now).date}`));
    const distance = (c.strikePaise - spot.prevClosePaise) / (spot.prevClosePaise * 0.03);
    const otmSide = c.kind === 'CE' ? c.strikePaise >= spot.prevClosePaise : c.strikePaise <= spot.prevClosePaise;
    const lots = Math.round((20_000 + rnd() * 80_000) * Math.exp(-(distance * distance) / 2) * (otmSide ? 1 : 0.45)) + 50;

    return {
      symbol: c.symbol,
      name: optionDisplayName(c),
      underlying: c.underlying,
      expiry: c.expiry,
      strikePaise: c.strikePaise,
      kind: c.kind,
      lotSize: cfg.lotSize,
      spotPaise: spot.ltpPaise,
      // An expired contract is worth exactly its intrinsic value (possibly zero).
      ltpPaise: expired ? Math.round(live.g.price * 100) : toTick(live.g.price * 100),
      prevClosePaise: toTick(prev.g.price * 100),
      iv: round(live.iv * 100, 2),
      delta: round(live.g.delta, 4),
      gamma: round(live.g.gamma, 6),
      theta: round(live.g.theta, 2),
      vega: round(live.g.vega, 2),
      oi: lots * cfg.lotSize,
      volume: Math.round(lots * (0.4 + rnd())) * cfg.lotSize,
      expired,
    };
  }

  /** What an option pays at expiry, per unit: max(0, spot − strike) for calls, max(0, strike − spot) for puts. */
  intrinsicPaise(c: OptionContract) {
    const spot = this.simulator.getQuote(c.underlying);
    if (!spot) throw new ServiceUnavailableException(`No live price for ${c.underlying}`);
    return Math.max(0, c.kind === 'CE' ? spot.ltpPaise - c.strikePaise : c.strikePaise - spot.ltpPaise);
  }

  private fairValue(c: OptionContract, spotPaise: number, years: number) {
    const cfg = UNDERLYINGS[c.underlying];
    const S = spotPaise / 100;
    const K = c.strikePaise / 100;
    // Volatility "smile": options far from the money (especially low-strike puts) are priced at a higher volatility.
    const x = Math.log(K / S);
    const iv = cfg.baseIv * (1 - 0.8 * x + 8 * x * x);
    return { iv, g: blackScholes(c.kind, S, K, years, RISK_FREE_RATE, iv) };
  }
}
