import 'dotenv/config';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { checkRequiredEnvVars } from './startup-env-check';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  // Falla rápido y con un mensaje claro si falta una variable de entorno
  // crítica (KEYCLOAK_CLIENT_SECRET, DATABASE_URL, etc.) — antes de que Nest
  // termine de levantar la app. Se salta solo en NODE_ENV=test (Jest).
  checkRequiredEnvVars();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // SEGURIDAD (subtask BL-30): headers de seguridad HTTP estándar.
  // helmet() agrega de una: HSTS (Strict-Transport-Security),
  // X-Frame-Options, X-Content-Type-Options, Referrer-Policy y CSP básica.
  app.use(helmet());

  // SEGURIDAD (subtask BL-30): redirección automática HTTP → HTTPS.
  // Railway termina TLS en su proxy y reenvía a la app por HTTP interno,
  // por eso confiamos en x-forwarded-proto. Si el header no está (health
  // checks directos al contenedor, entorno local), NO se redirige — así no
  // rompemos health checks ni el desarrollo local.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const proto = req.header('x-forwarded-proto');
    if (proto && proto !== 'https') {
      return res.redirect(
        301,
        `https://${req.header('host')}${req.originalUrl}`,
      );
    }
    next();
  });

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true, // necesario para que @ValidateNested (arrays anidados, ej. ítems del pedido) valide bien objetos JSON planos
    }),
  );
  const port = process.env.PORT || 3001;
  await app.listen(port);
  app
    .get(Logger)
    .log(`Application is running on: http://localhost:${port}`, 'Main');
}
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
