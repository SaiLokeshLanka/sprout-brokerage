import { BadRequestException, Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { AmountDto, TransactionsQuery } from './wallet.dto';
import { WalletService } from './wallet.service';

function checkIdempotencyKey(key?: string) {
  if (key !== undefined && (key.length < 8 || key.length > 100)) {
    throw new BadRequestException('Idempotency-Key must be 8–100 characters');
  }
  return key;
}

@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** GET /api/wallet */
  @Get()
  balance(@CurrentUser() user: AuthUser) {
    return this.wallet.getBalance(user.id);
  }

  /** GET /api/wallet/transactions?limit=20&cursor=<id> */
  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser, @Query() query: TransactionsQuery) {
    return this.wallet.transactions(user.id, query.limit, query.cursor);
  }

  /** POST /api/wallet/deposit  { amountPaise }  — optional header Idempotency-Key */
  @Post('deposit')
  deposit(@CurrentUser() user: AuthUser, @Body() dto: AmountDto, @Headers('idempotency-key') key?: string) {
    return this.wallet.deposit(user.id, dto.amountPaise, checkIdempotencyKey(key));
  }

  /** POST /api/wallet/withdraw  { amountPaise }  — requires verified KYC */
  @Post('withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: AmountDto, @Headers('idempotency-key') key?: string) {
    return this.wallet.withdraw(user.id, dto.amountPaise, checkIdempotencyKey(key));
  }
}
