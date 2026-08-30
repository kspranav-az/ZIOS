import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from '@/modules/auth';
import { ConsentModule } from '@/modules/consent';
import { DatabaseModule } from '@/modules/database';
import { EvaluationModule } from '@/modules/evaluation';
import { GenerationModule } from '@/modules/generation';
import { HealthModule } from '@/modules/health';
import { InvitesModule } from '@/modules/invites';
import { KitsModule } from '@/modules/kits';
import { CreditsModule } from '@/modules/credits';
import { OrgModule } from '@/modules/org';
import { QuestionBankModule } from '@/modules/question-bank';
import { IntegrityModule } from '@/modules/integrity';
import { SessionsModule } from '@/modules/sessions';
import { UsersModule } from '@/modules/users';
import { VoiceModule } from '@/modules/voice';
import { LiveRoomsModule } from '@/modules/live-rooms';
import { AsyncVideoInterviewsModule } from '@/modules/async-video-interviews';

@Module({
  imports: [
    // Structured JSON logging with a correlation ID per request (observability
    // baseline, phase-00). Incoming x-request-id is honored, else a UUID is
    // minted and echoed back in the response header.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id =
            typeof incoming === 'string' && incoming.trim().length > 0 ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
      },
    }),
    DatabaseModule,
    UsersModule,
    OrgModule,
    CreditsModule,
    AuthModule,
    HealthModule,
    QuestionBankModule,
    KitsModule,
    InvitesModule,
    ConsentModule,
    EvaluationModule,
    GenerationModule,
    SessionsModule,
    VoiceModule,
    IntegrityModule,
    LiveRoomsModule,
    AsyncVideoInterviewsModule,
  ],
})
export class AppModule {}
