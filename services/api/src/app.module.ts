import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from '@/modules/auth';
import { DatabaseModule } from '@/modules/database';
import { HealthModule } from '@/modules/health';
import { KitsModule } from '@/modules/kits';
import { OrgModule } from '@/modules/org';
import { QuestionBankModule } from '@/modules/question-bank';
import { UsersModule } from '@/modules/users';

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
    AuthModule,
    HealthModule,
    QuestionBankModule,
    KitsModule,
  ],
})
export class AppModule {}
