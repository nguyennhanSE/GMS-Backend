import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator to extract the current authenticated user from the request.
 * The user is attached to the request by the AuthGuard after JWT verification.
 *
 * Usage:
 * @Get('profile')
 * getProfile(@CurrentUser() user: RequestUser) {
 *   return user;
 * }
 *
 * Or extract a specific property:
 * @Get('profile')
 * getProfile(@CurrentUser('sub') userId: string) {
 *   return userId;
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as RequestUser;

    return data ? user?.[data] : user;
  },
);

/**
 * The user object shape as attached by AuthGuard
 */
export interface RequestUser {
  sub: string; // User ID
  email: string;
  tokenType: string;
  roles: string[];
}
