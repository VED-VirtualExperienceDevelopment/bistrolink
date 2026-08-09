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
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // Censura el JWT (y cualquier cookie de sesión) en TODOS los logs
        // generados por pinoHttp — incluye tanto el access log automático
        // de cada request como cualquier log de contexto (p.ej. "Audit")
        // que se emita dentro del mismo request, porque nestjs-pino
        // bindea el logger al objeto `req` completo por request.
        // No borra el campo, lo reemplaza por "[REDACTED]" — así se
        // sigue viendo que el header existía, sin exponer el valor.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
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
    RestaurantesModule,
  ],
  controllers: [AppController, HealthController, TestController],
  providers: [AppService],
})
export class AppModule {}
