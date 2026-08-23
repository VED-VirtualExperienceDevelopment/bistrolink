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
import { RestaurantesModule } from './restaurantes/restaurantes.module';
import { stdTimeFunctions } from 'pino';
const isProd = process.env.NODE_ENV === 'production';

const targets = [
  ...(!isProd
    ? [
        {
          target: 'pino-pretty',
          level: 'trace',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      ]
    : []),
  {
    target: 'pino-loki',
    level: 'trace',
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
        developer: process.env.DEV_NAME ?? 'unknown',
      },
    },
  },
];

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        timestamp: stdTimeFunctions.isoTime,
        base: {
          developer: process.env.DEV_NAME ?? 'unknown',
        },
        customLogLevel: (req, res, err) => {
          if (res.statusCode >= 500 || err) return 'error';
          if (res.statusCode >= 400) return 'warn';
          if (res.statusCode >= 300) return 'silent';
          return 'info';
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        transport: { targets },
      },
    }),
    AuthModule,
    PrismaModule,
    MenuModule,
    UsuariosModule,
    RestaurantesModule,
  ],
  controllers: [AppController, HealthController, TestController],
  providers: [AppService],
})
export class AppModule {}
//to deploy api
