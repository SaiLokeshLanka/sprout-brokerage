import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { Quote, QUOTES_KEY } from './market.types';

/** Reads the latest quotes from Redis — the shared cache the simulator writes every tick. */
@Injectable()
export class QuotesService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async all(): Promise<Quote[]> {
    const values = await this.read(() => this.redis.hvals(QUOTES_KEY));
    return values.map((v) => JSON.parse(v) as Quote).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async one(symbol: string): Promise<Quote> {
    const value = await this.read(() => this.redis.hget(QUOTES_KEY, symbol));
    if (!value) throw new NotFoundException(`No quote for ${symbol}`);
    return JSON.parse(value) as Quote;
  }

  private async read<T>(fn: () => Promise<T>): Promise<T> {
    // Fail fast instead of waiting on reconnect attempts while Redis is down.
    if (this.redis.status !== 'ready') throw new ServiceUnavailableException('Live prices are temporarily unavailable');
    try {
      return await fn();
    } catch {
      throw new ServiceUnavailableException('Live prices are temporarily unavailable');
    }
  }
}
