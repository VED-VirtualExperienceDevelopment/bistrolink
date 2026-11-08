import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PrismaRuntimeClient } from '../prisma/prisma-runtime.client';
import {
  ResumenSincronizacionPos,
  SincronizacionPosService,
  resumenSincronizacionPosVacio,
} from './sincronizacion-pos.service';
import { ConfiguracionPos, configuracionPos } from './configuracion-pos';

/**
 * HU-011 (BL-488): cada `intervaloMs` reintenta mandar al POS las ventas y
 * anulaciones PENDIENTES, establecimiento por establecimiento.
 *
 * Mismo esquema que RespaldoPdfJob: timer de Node con unref(), nunca dos
 * corridas a la vez en el mismo proceso, la lista de establecimientos sale
 * de `tenant` (sin RLS) y cada fila se lee dentro de su tenant. Con varias
 * réplicas es seguro: la venta va con el id del pedido como referencia y el
 * POS no la registra dos veces.
 */
@Injectable()
export class SincronizacionPosJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SincronizacionPosJob.name);
  private readonly configuracion: ConfiguracionPos = configuracionPos(
    process.env,
  );
  private readonly contextId = ContextIdFactory.create();
  private servicio?: SincronizacionPosService;
  private timer?: NodeJS.Timeout;
  private enCurso = false;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaRuntimeClient,
  ) {}

  onApplicationBootstrap(): void {
    const { jobHabilitado, adaptador, intervaloMs, maxIntentos } =
      this.configuracion;
    if (!jobHabilitado || adaptador === 'deshabilitado') {
      this.logger.log('Sincronización con el POS: deshabilitada');
      return;
    }
    this.timer = setInterval(() => {
      void this.ejecutar();
    }, intervaloMs);
    this.timer.unref();
    this.logger.log(
      `Sincronización con el POS (${adaptador}): cada ${intervaloMs / 1000} s, hasta ${maxIntentos} intentos`,
    );
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /**
   * Una corrida sobre todos los establecimientos. Devuelve null si ya había
   * una en curso. Nunca lanza: un error de un establecimiento queda en el log
   * y no frena a los demás.
   */
  async ejecutar(
    ahora: Date = new Date(),
  ): Promise<ResumenSincronizacionPos | null> {
    if (this.enCurso) return null;
    this.enCurso = true;
    const total = resumenSincronizacionPosVacio();
    let errores = 0;
    try {
      this.servicio ??= await this.moduleRef.resolve(
        SincronizacionPosService,
        this.contextId,
        { strict: false },
      );
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
      });
      // Secuencial a propósito (Sonar S9382): un establecimiento por vez.
      for (const { id } of tenants) {
        try {
          const resumen = await /* NOSONAR */ this.servicio.sincronizarTenant(
            id,
            this.configuracion,
            ahora,
          );
          total.revisados += resumen.revisados;
          total.enviados += resumen.enviados;
          total.fallidos += resumen.fallidos;
        } catch (error) {
          errores++;
          this.logger.error(
            `Sincronización con el POS: falló en el tenant ${id}: ${(error as Error).message}`,
          );
        }
      }
      if (total.revisados > 0 || errores > 0) {
        this.logger.log({
          message: `Sincronización con el POS: ${total.revisados} revisados, ${total.enviados} enviados, ${total.fallidos} fallidos, ${errores} establecimientos con error`,
          ...total,
          errores,
        });
      }
    } catch (error) {
      this.logger.error(
        `Sincronización con el POS: no se pudo ejecutar: ${(error as Error).message}`,
      );
    } finally {
      this.enCurso = false;
    }
    return total;
  }
}
