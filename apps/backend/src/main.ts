import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common'; // <-- Aquí está definido

async function bootstrap() {
  // 1. Instanciamos el Logger pasándole el contexto 'Main' para usarlo
  const logger = new Logger('Main');
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  const port = process.env.PORT || 3001;
  await app.listen(port);
  // 2. Aquí lo usamos. Al llamarlo, ESLint verá que ya no está en desuso
  logger.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
