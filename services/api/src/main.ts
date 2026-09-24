import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { initTracing } from './observability/tracing';

async function bootstrap(): Promise<void> {
  initTracing();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Session cookie parsing (zios_session, httpOnly) — see the auth module.
  app.use(cookieParser());

  // JSON bodies carry base64 audio for voice-practice turns (POST
  // /cand/practice/:id/turn-audio, Phase 12b); a few seconds of webm
  // base64s past the 100 kb default and 413s with "request entity too
  // large" (found live). 15 mb leaves generous headroom for long answers.
  app.useBodyParser('json', { limit: '15mb' });

  // SPA dev server origins (Vite: employer :5173, candidate :5174, ascend :5175);
  // credentials for the session cookie.
  // Origins are normalised to lowercase because browsers send the Origin header
  // with a lowercase host, and the CORS middleware does a case-sensitive match.
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
      .split(',')
      .map((origin) => origin.trim().toLowerCase()),
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
