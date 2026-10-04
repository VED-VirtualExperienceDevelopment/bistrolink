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
import { AuthComensalModule } from './auth-comensal/auth-comensal.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { MesasModule } from './mesas/mesas.module';
import { PagosModule } from './pagos/pagos.module';
import { construirConfiguracionLog } from './logger/destinos-log';

// BL-273: destinos y formato de los logs según el entorno (ver
// logger/destinos-log.ts).
const configuracionLog = construirConfiguracionLog(process.env);

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: configuracionLog.level,
        messageKey: configuracionLog.messageKey,
        base: {
          developer: process.env.DEV_NAME ?? 'unknown',
        },
        mixin() {
          return {
            readableTime: new Date().toLocaleString('es-UY', {
              timeZone: 'America/Montevideo',
            }),
          };
        },
        customLogLevel: (req, res, err) => {
          if (res.statusCode >= 500 || err) return 'error';
          if (res.statusCode >= 400) return 'warn';
          if (res.statusCode >= 300) return 'info'; // antes: 'silent'
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
        transport: { targets: configuracionLog.targets },
      },
    }),
    AuthModule,
    PrismaModule,
    MenuModule,
    UsuariosModule,
    RestaurantesModule,
    AuthComensalModule,
    PedidosModule,
    MesasModule,
    PagosModule,
  ],
  controllers: [AppController, HealthController, TestController],
  providers: [AppService],
})
export class AppModule {}
//to deploy api
