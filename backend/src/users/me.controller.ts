import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { KycDto, UpdateProfileDto } from './users.dto';
import { UsersService } from './users.service';

/** Endpoints about the logged-in user. There is no /users/:id — nobody can read someone else's profile. */
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  /** GET /api/me */
  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.users.getProfile(user.id);
  }

  /** PATCH /api/me  { fullName?, phone? } */
  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  /** POST /api/me/kyc  { pan, dateOfBirth } */
  @Post('kyc')
  @HttpCode(200)
  kyc(@CurrentUser() user: AuthUser, @Body() dto: KycDto) {
    return this.users.submitKyc(user.id, dto);
  }
}
