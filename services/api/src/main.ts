import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { initTracing } from './observability/tracing';

async function bootstrap(): Promise<void> {
  initTracing();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Session cookie parsing (zios_session, httpOnly) — see the auth module.
  app.use(cookieParser());

  // SPA dev server origin (Vite on :5173); credentials for the session cookie.
  // Origins are normalised to lowercase because browsers send the Origin header
  // with a lowercase host, and the CORS middleware does a case-sensitive match.
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim().toLowerCase()),
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
