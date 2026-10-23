import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { REDIS } from '../redis/redis.module';
import { MarketSimulatorService } from './market-simulator.service';
import { STATUS_CHANNEL, TICKS_CHANNEL } from './market.types';
import { QuotesService } from './quotes.service';

/**
 * Live prices over WebSocket (Socket.IO, path /socket.io).
 *
 * Server → client events:
 *   'status'   MarketStatus — on connect and whenever the session opens/closes/pauses
 *   'snapshot' Quote[]      — all latest quotes, once on connect
 *   'ticks'    Quote[]      — every tick
 *
 * The gateway only relays what the simulator publishes on Redis, so every API
 * instance behind a load balancer would push identical prices.
 */
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173', credentials: true } })
export class MarketGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(MarketGateway.name);
  private subscriber?: Redis;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly quotes: QuotesService,
    private readonly simulator: MarketSimulatorService,
  ) {}

  afterInit() {
    // A Redis connection in subscribe mode can't run other commands, so use a dedicated one.
    // maxRetriesPerRequest: null → wait for Redis to come up rather than failing the subscription.
    this.subscriber = this.redis.duplicate({ maxRetriesPerRequest: null });
    this.subscriber.on('error', () => undefined); // outages are already logged by the main client
    this.subscriber.subscribe(TICKS_CHANNEL, STATUS_CHANNEL).catch((err) => this.logger.error(`Subscribe failed: ${err.message}`));
    this.subscriber.on('message', (channel, message) => {
      this.server.emit(channel === TICKS_CHANNEL ? 'ticks' : 'status', JSON.parse(message));
    });
  }

  async handleConnection(client: Socket) {
    client.emit('status', this.simulator.status());
    try {
      client.emit('snapshot', await this.quotes.all());
    } catch {
      // Redis is down; the client will get prices with the first tick after it recovers.
    }
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => this.subscriber?.disconnect());
  }
}
