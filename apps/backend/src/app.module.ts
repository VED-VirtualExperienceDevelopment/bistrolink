import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { TestController } from './test/test.controller';
import { MenuModule } from './menu/menu.module';
import { UsuariosModule } from './usuarios/usuarios.module';
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-loki',
          options: {
            batching: true,
            interval: 5,
            host: `${process.env.LOKI_URL}`,
            basicAuth: {
              username: process.env.LOKI_USERNAME,
              password: process.env.LOKI_PASSWORD,
            },
            labels: {
              app: 'bistrolink',
              env: process.env.NODE_ENV ?? 'staging',
            },
          },
        },
      },
    }),
    AuthModule,
    PrismaModule,
    MenuModule,
    UsuariosModule,
  ],
  controllers: [AppController, HealthController, TestController],
  providers: [AppService],
})
export class AppModule {}