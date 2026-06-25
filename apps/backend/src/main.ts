import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableCors();
  const port = process.env.PORT || 3001;
  await app.listen(port);
  app.get(Logger).log(`Application is running on: http://localhost:${port}`, 'Main');
}
bootstrap();
