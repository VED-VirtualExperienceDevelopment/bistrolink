import { Logger, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { POS_ADAPTER, PosAdapter } from './pos.adapter';
import { PosMockAdapter } from './pos-mock.adapter';
import { PosHttpAdapter } from './pos-http.adapter';
import { ConfiguracionPos, configuracionPos } from './configuracion-pos';
import { SincronizacionPosService } from './sincronizacion-pos.service';
import { SincronizacionPosJob } from './sincronizacion-pos.job';
import { SincronizacionPosController } from './sincronizacion-pos.controller';
import { ImportacionVentasPosService } from './importacion-ventas-pos.service';
import { ResumenVentasModule } from '../reportes/resumen-ventas.module';

/**
 * El adaptador según POS_ADAPTER. Con «http» sin URL HTTPS o sin token, no
 * hay POS (null) y queda un error en el log: la API arranca igual y no se
 * encola nada.
 */
export function crearAdaptadorPos(
  configuracion: ConfiguracionPos,
): PosAdapter | null {
  const logger = new Logger('PosModule');
  if (configuracion.adaptador === 'deshabilitado') return null;
  if (configuracion.adaptador === 'mock') {
    return new PosMockAdapter(configuracion.mockDisponible);
  }
  if (!configuracion.apiUrl || !configuracion.apiToken) {
    logger.error('POS_ADAPTER=http necesita POS_API_URL y POS_API_TOKEN');
    return null;
  }
  try {
    return new PosHttpAdapter(
      configuracion.apiUrl,
      configuracion.apiToken,
      configuracion.timeoutMs,
    );
  } catch (error) {
    logger.error((error as Error).message);
    return null;
  }
}

/** El adaptador que pide el entorno (provider de POS_ADAPTER). */
export function adaptadorPosDelEntorno(): PosAdapter | null {
  return crearAdaptadorPos(configuracionPos(process.env));
}

/**
 * HU-011 (BL-488): integración con el POS del local. PedidosModule usa el
 * servicio al confirmar un pago y PagosModule al cancelar un pedido. BL-489:
 * trae las ventas hechas en el POS al resumen del dashboard.
 */
@Module({
  imports: [PrismaModule, ResumenVentasModule],
  controllers: [SincronizacionPosController],
  providers: [
    {
      provide: POS_ADAPTER,
      useFactory: adaptadorPosDelEntorno,
    },
    SincronizacionPosService,
    ImportacionVentasPosService,
    SincronizacionPosJob,
    AuditLogService,
  ],
  exports: [SincronizacionPosService, POS_ADAPTER],
})
export class PosModule {}
