import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NotificationsModule } from '@/modules/notifications';
import { OrgModule } from '@/modules/org';
import { UsersModule } from '@/modules/users';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MockOAuthAdapter } from './mock-oauth.adapter';
import { OAUTH_PORT } from './oauth.port';
import { OtpRepository } from './otp.repository';
import { OtpService } from './otp.service';
import { RolesGuard } from './roles.guard';
import { SessionAuthMiddleware } from './session-auth.middleware';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

@Module({
  imports: [NotificationsModule, UsersModule, OrgModule],
  controllers: [AuthController],
  providers: [
    OtpRepository,
    OtpService,
    SessionRepository,
    SessionService,
    AuthService,
    SessionAuthMiddleware,
    { provide: OAUTH_PORT, useClass: MockOAuthAdapter },
    // Global guards, in order: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [OtpService, SessionService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionAuthMiddleware).forRoutes('*');
  }
}
