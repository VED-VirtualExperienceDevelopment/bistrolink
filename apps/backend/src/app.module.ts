import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { LoggerModule } from 'nestjs-pino';
import {
  CABECERAS_CON_IP_EN_LOGS,
  CAMPOS_PERSONALES_EN_LOGS,
} from './logs-datos-personales';
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
import { LinkPagoModule } from './link-pago/link-pago.module';
import { PlataformaApiModule } from './plataforma/plataforma-api.module';
import { construirConfiguracionLog } from './logger/destinos-log';
import { AuditoriaModule } from './audit-log/auditoria.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { ComprobantesModule } from './comprobantes/comprobantes.module';
import { ReportesModule } from './reportes/reportes.module';
import { StockModule } from './stock/stock.module';
import { PosModule } from './pos/pos.module';
import { modulosDeTesting } from './testing/testing.module';
import { ContextoAuditoriaMiddleware } from './audit-log/contexto-auditoria';

// BL-273: destinos y formato de los logs según el entorno (ver
// logger/destinos-log.ts).
const configuracionLog = construirConfiguracionLog(process.env);

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: configuracionLog.level,
        messageKey: configuracionLog.messageKey,
        // BL-274: los logs que se emiten dentro de un request (por ejemplo,
        // el audit log) llevan solo el reqId, no el request entero con
        // headers e IP. El detalle queda en el log "request completed",
        // que tiene el mismo reqId para cruzarlos.
        quietReqLogger: true,
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
          // HU-036 (BL-206): además de credenciales, datos personales que
          // podrían llegar a un log como campo de un objeto (Ley 18.331).
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            ...CAMPOS_PERSONALES_EN_LOGS,
            ...CABECERAS_CON_IP_EN_LOGS,
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
    LinkPagoModule,
    // BL-163 (HU-027): /plataforma/establecimientos, solo rol PLATAFORMA.
    PlataformaApiModule,
    // HU-035 (BL-205): GET /auditoria, solo ADMIN.
    AuditoriaModule,
    // HU-020 (BL-72): GET y PATCH /admin/configuracion, solo ADMIN.
    ConfiguracionModule,
    ComprobantesModule, // BL-455
    // HU-012 (BL-108): GET /admin/reportes, solo ADMIN.
    ReportesModule,
    // HU-015 (BL-120): stock de la jornada y alertas, solo ADMIN.
    StockModule,
    // HU-011 (BL-488): sincronización con el POS del local.
    PosModule,
    // BL-475 (BL-285): POST /testing/limpieza, solo con
    // E2E_CLEANUP_ENABLED=true (staging y local; nunca en producción).
    ...modulosDeTesting(),
  ],
  controllers: [AppController, HealthController, TestController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  // HU-035 (BL-205): la IP de cada request queda disponible para el registro
  // de auditoría (contexto-auditoria.ts).
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContextoAuditoriaMiddleware).forRoutes('*');
  }
}
//to deploy api
