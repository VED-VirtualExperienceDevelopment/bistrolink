import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { checkRequiredEnvVars } from './startup-env-check';

async function bootstrap() {
  // Falla rápido y con un mensaje claro si falta una variable de entorno
  // crítica (KEYCLOAK_CLIENT_SECRET, DATABASE_URL, etc.) — antes de que Nest
  // termine de levantar la app. Se salta solo en NODE_ENV=test (Jest).
  checkRequiredEnvVars();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableCors();
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