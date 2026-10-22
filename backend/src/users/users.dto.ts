import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimUpper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'Full name must be 2–80 characters' })
  fullName?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit Indian mobile number' })
  phone?: string;
}

export class KycDto {
  /** Indian PAN: 5 letters, 4 digits, 1 letter — e.g. ABCDE1234F */
  @Transform(trimUpper)
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'PAN must look like ABCDE1234F' })
  pan!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be in YYYY-MM-DD format' })
  dateOfBirth!: string;
}
