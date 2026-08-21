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
        // Agrega el nombre del developer a CADA línea de log (no solo como
        // label de Loki para filtrar) — así se ve directo en el JSON, tanto
        // en la terminal local como en el panel de Grafana.
        base: {
          developer: process.env.DEV_NAME ?? 'unknown',
        },
        // Asigna el nivel de log segun el status code real de la respuesta,
        // en vez de dejar todo en 'info' por default (que es lo que hacia
        // pino-http antes, incluso para 500). Asi el panel "Errores" del
        // dashboard puede filtrar por level en vez de por texto crudo.
        customLogLevel: (req, res, err) => {
          if (res.statusCode >= 500 || err) return 'error';
          if (res.statusCode >= 400) return 'warn';
          if (res.statusCode >= 300) return 'silent';
          return 'info';
        },
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
          targets: [
            // Terminal legible, solo mientras programás localmente.
            {
              target: 'pino-pretty',
              level: 'trace',
              options: {
                colorize: true,
                translateTime: 'SYS:HH:MM:ss',
                ignore: 'pid,hostname',
              },
            },
            // Grafana Cloud — igual que antes, sin cambios de fondo.
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
          ],
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
