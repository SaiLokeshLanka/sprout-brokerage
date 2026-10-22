import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const MIN_TXN_PAISE = 100; // ₹1
export const MAX_TXN_PAISE = 100_000_000; // ₹10,00,000

export class AmountDto {
  @IsInt({ message: 'amountPaise must be a whole number of paise' })
  @Min(MIN_TXN_PAISE, { message: 'Minimum amount is ₹1' })
  @Max(MAX_TXN_PAISE, { message: 'Maximum amount per transaction is ₹10,00,000' })
  amountPaise!: number;
}

export class TransactionsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
