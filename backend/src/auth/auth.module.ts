import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { WalletModule } from '../wallet/wallet.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
        if (config.get('NODE_ENV') === 'production' && (secret.length < 32 || secret.startsWith('change-me'))) {
          throw new Error('JWT_ACCESS_SECRET must be a long random secret in production');
        }
        return { secret, signOptions: { expiresIn: config.get<string>('JWT_ACCESS_TTL', '15m') } };
      },
    }),
    WalletModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
