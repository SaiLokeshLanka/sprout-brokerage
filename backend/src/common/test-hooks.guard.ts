import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Hides test-only endpoints completely (404) unless ENABLE_TEST_HOOKS=true,
 * and always in production — they let anyone move prices or expire orders.
 */
@Injectable()
export class TestHooksGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate() {
    const enabled = this.config.get('ENABLE_TEST_HOOKS') === 'true' && this.config.get('NODE_ENV') !== 'production';
    if (!enabled) throw new NotFoundException();
    return true;
  }
}
