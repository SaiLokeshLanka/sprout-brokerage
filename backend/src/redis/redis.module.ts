import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Injection token for the shared Redis client: `@Inject(REDIS) redis: Redis`. */
export const REDIS = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('Redis');
        const client = new Redis(config.get('REDIS_URL', 'redis://localhost:6379'), {
          // Fail commands quickly while Redis is down instead of queueing them forever.
          maxRetriesPerRequest: 2,
          retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
        });
        let reportedDown = false;
        client.on('ready', () => {
          logger.log('Connected');
          reportedDown = false;
        });
        // ioredis emits an error on every failed reconnect attempt; log the outage once.
        client.on('error', (err) => {
          if (!reportedDown) logger.warn(`Unavailable (${err.message}); retrying in the background`);
          reportedDown = true;
        });
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
