import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /api/health — liveness plus a database connectivity check. */
  @Get()
  async check() {
    let db: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      uptimeSec: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  }
}
