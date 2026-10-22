import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The identity attached to a request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
}

/** Injects the logged-in user into a controller method: `me(@CurrentUser() user: AuthUser)`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
