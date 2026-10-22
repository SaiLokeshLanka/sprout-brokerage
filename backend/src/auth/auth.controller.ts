import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { Public } from '../common/public.decorator';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthService, Session } from './auth.service';

const REFRESH_COOKIE = 'sprout_rt';

/**
 * The access token goes in the response body (the frontend keeps it in memory only).
 * The refresh token goes in an httpOnly cookie that JavaScript can't read — so an
 * XSS bug can't steal a long-lived session — scoped to /api/auth so it's sent nowhere else.
 */
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** POST /api/auth/register  { fullName, email, password } */
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.register(dto));
  }

  /** POST /api/auth/login  { email, password } */
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto));
  }

  /** POST /api/auth/refresh  (refresh cookie) → new access token + rotated cookie */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  }

  /** POST /api/auth/logout */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private respond(res: Response, session: Session) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...this.cookieOptions(), expires: session.refreshExpiresAt });
    return { accessToken: session.accessToken, user: session.user };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('COOKIE_SECURE') === 'true',
      path: '/api/auth',
    };
  }
}
