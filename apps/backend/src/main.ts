import 'dotenv/config';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { checkRequiredEnvVars } from './startup-env-check';
import { origenesPermitidos, redireccionHttps } from './seguridad-http';
import { ValidationPipe } from '@nestjs/common';
import { configurarOpenApi, RUTA_DOCS } from './openapi';

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
  // BL-426: el destino es el dominio público de la API, no el header Host
  // que manda el cliente (ver seguridad-http.ts).
  app.use(redireccionHttps());

  // BL-426: solo el frontend (FRONTEND_URL y CORS_ORIGENES_EXTRA). Antes,
  // enableCors() sin opciones aceptaba cualquier origen.
  app.enableCors({ origin: origenesPermitidos() });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true, // necesario para que @ValidateNested (arrays anidados, ej. ítems del pedido) valide bien objetos JSON planos
    }),
  );
  // BL-211: contrato OpenAPI 3 en /api/docs (local y staging; apagado en
  // producción salvo OPENAPI_HABILITADO=true, ver openapi.ts).
  const conDocs = configurarOpenApi(app);
  const port = process.env.PORT || 3001;
  await app.listen(port);
  app
    .get(Logger)
    .log(`Application is running on: http://localhost:${port}`, 'Main');
  if (conDocs) {
    app
      .get(Logger)
      .log(`Contrato OpenAPI: http://localhost:${port}/${RUTA_DOCS}`, 'Main');
  }
}
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
