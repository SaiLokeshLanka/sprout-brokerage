import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { AppModule } from './app.module';
import { DatabaseUnavailableFilter } from './common/database-unavailable.filter';

/**
 * In production the API also serves the built web app, so both share one address.
 * That keeps the refresh cookie same-site (SameSite=Strict) and needs no CORS.
 * During development Vite serves the web app instead, and frontend/dist does not exist.
 */
function serveWebApp(app: NestExpressApplication) {
  const webDir = join(__dirname, '..', '..', 'frontend', 'dist');
  if (!existsSync(join(webDir, 'index.html'))) return;

  // Files in assets/ have a content hash in their name, so browsers may keep them forever.
  app.useStaticAssets(webDir, {
    index: false,
    setHeaders: (res, path) =>
      res.setHeader('Cache-Control', path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
  });
  // Any other page (/funds, /stock/TCS…) is a React route: send index.html and let React draw it.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(webDir, 'index.html'));
  });
  Logger.log(`Serving the web app from ${webDir}`, 'Bootstrap');
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: config.get<string>('CORS_ORIGIN', 'http://localhost:5173'), credentials: true });
  // Validate every request body/query against its DTO; reject unknown fields.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DatabaseUnavailableFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();
  serveWebApp(app);

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap();
