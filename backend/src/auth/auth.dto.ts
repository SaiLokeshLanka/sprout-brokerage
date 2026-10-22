import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RegisterDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'Full name must be 2–80 characters' })
  fullName!: string;

  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  // bcrypt only uses the first 72 bytes of a password
  @MaxLength(72, { message: 'Password must be at most 72 characters' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'Password must contain at least one letter and one number' })
  password!: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter your password' })
  @MaxLength(72)
  password!: string;
}
