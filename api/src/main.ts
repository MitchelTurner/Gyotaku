import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Reflect the request Origin by default so the web service can call the API.
  // If CORS_ORIGINS is set, only those origins are allowed.
  app.enableCors({
    origin: origins.length
      ? (
          origin: string | undefined,
          cb: (err: Error | null, allow?: boolean | string) => void,
        ) => {
          if (!origin) return cb(null, true);
          if (origins.includes('*') || origins.includes(origin)) {
            return cb(null, origin);
          }
          // eslint-disable-next-line no-console
          console.warn(
            `[cors] blocked origin ${origin}; allowed=${origins.join(',')}`,
          );
          return cb(null, false);
        }
      : true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`gyotaku api listening on :${port}`);
}
bootstrap();
