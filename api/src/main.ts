import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody required for Stripe webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Always reflect the request Origin. A stale CORS_ORIGINS=http://localhost:5173
  // on Railway was blocking https://gyotaku-web.up.railway.app → "Failed to fetch".
  // Set CORS_STRICT=1 to enforce CORS_ORIGINS as an allowlist.
  const strict = process.env.CORS_STRICT === '1' || process.env.CORS_STRICT === 'true';
  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: strict
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
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'x-operator-token',
    ],
  });

  // eslint-disable-next-line no-console
  console.log(
    strict
      ? `[cors] strict allowlist: ${origins.join(',') || '(empty)'}`
      : '[cors] reflecting any Origin (set CORS_STRICT=1 to lock down)',
  );

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
