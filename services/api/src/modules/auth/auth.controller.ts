import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  AppUser,
  AuthResponse,
  MeResponse,
  OtpRequestBody,
  OtpRequestResponse,
  OtpVerifyBody,
} from '@zios/shared-types';
import { getRequestAuth } from '@/common/auth-context';
import { CurrentUser, Public } from '@/common/decorators';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from './auth.constants';
import { AuthService } from './auth.service';
import { OAUTH_PORT, type OAuthPort } from './oauth.port';

/**
 * Session transport contract for the SPA: the raw token is returned in the
 * body AND set as an httpOnly cookie (SameSite=Lax). Browser clients should
 * rely on the cookie (XSS-safe, no token in JS); the Bearer header is the
 * fallback for non-browser clients.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(OAUTH_PORT) private readonly oauth: OAuthPort,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() body: OtpRequestBody): Promise<OtpRequestResponse> {
    return this.auth.requestOtp(body?.email);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() body: OtpVerifyBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.verifyOtp(body?.email, body?.code);
    this.setSessionCookie(res, result.session.token);
    return result;
  }

  private setSessionCookie(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const auth = getRequestAuth(req);
    if (auth) {
      await this.auth.logout(auth.sessionId);
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Public()
  @Get('google')
  @HttpCode(302)
  async googleAuth(@Res({ passthrough: true }) res: Response): Promise<void> {
    const redirectUri = `${process.env.API_URL ?? 'http://localhost:3000'}/auth/google/callback`;
    const state = 'mock-state';
    const url = await this.oauth.authorizationUrl(state, redirectUri);
    res.redirect(url);
  }

  @Public()
  @Get('google/callback')
  @HttpCode(200)
  async googleCallback(
    @Query('code') code: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const redirectUri = `${process.env.API_URL ?? 'http://localhost:3000'}/auth/google/callback`;
    const identity = await this.oauth.exchangeCode(code ?? '', redirectUri);
    const result = await this.auth.oauthSignIn(identity.email, identity.provider);
    this.setSessionCookie(res, result.session.token);
    return result;
  }

  @Get('me')
  me(@CurrentUser() user: AppUser): Promise<MeResponse> {
    return this.auth.me(user);
  }
}
