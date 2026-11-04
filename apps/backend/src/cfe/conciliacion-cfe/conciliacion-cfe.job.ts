import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PrismaRuntimeClient } from '../../prisma/prisma-runtime.client';
import {
  ConciliacionCfeService,
  ResumenConciliacionCfe,
  resumenConciliacionCfeVacio,
} from './conciliacion-cfe.service';
import {
  ConfiguracionConciliacionCfe,
  configuracionConciliacionCfe,
} from './configuracion-conciliacion-cfe';

/**
 * HU-023 (BL-96): reintenta cada `intervaloMs` la emisión de los CFE
 * pendientes (pagos aprobados sin comprobante), establecimiento por
 * establecimiento.
 *
 * Mismo esquema que ConciliacionPagosJob y EstadoDgiJob: timer de Node con
 * unref(), nunca dos corridas a la vez en el mismo proceso, la lista de
 * establecimientos sale de `tenant` (sin RLS) y cada pago se lee dentro de
 * su tenant. Con varias réplicas es seguro: la emisión es idempotente por
 * id_externo y el comprobante se guarda con upsert.
 */
@Injectable()
export class ConciliacionCfeJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ConciliacionCfeJob.name);
  private readonly configuracion: ConfiguracionConciliacionCfe =
    configuracionConciliacionCfe(process.env);
  private readonly contextId = ContextIdFactory.create();
  private servicio?: ConciliacionCfeService;
  private timer?: NodeJS.Timeout;
  private enCurso = false;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaRuntimeClient,
  ) {}

  onApplicationBootstrap(): void {
    const { habilitada, intervaloMs, dias, maxIntentos } = this.configuracion;
    if (!habilitada) {
      this.logger.log('Conciliación de CFE pendientes: deshabilitada');
      return;
    }
    this.timer = setInterval(() => {
      void this.ejecutar();
    }, intervaloMs);
    this.timer.unref();
    this.logger.log(
      `Conciliación de CFE pendientes: cada ${intervaloMs / 60_000} min, pagos de los últimos ${dias} días, hasta ${maxIntentos} intentos`,
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
  ): Promise<ResumenConciliacionCfe | null> {
    if (this.enCurso) return null;
    this.enCurso = true;
    const total = resumenConciliacionCfeVacio();
    let errores = 0;
    try {
      this.servicio ??= await this.moduleRef.resolve(
        ConciliacionCfeService,
        this.contextId,
        { strict: false },
      );
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
      });

      // Secuencial a propósito (Sonar S9382): un establecimiento por vez,
      // sin ráfagas a Surtec ni varias conexiones del pool único (BL-430).
      for (const { id } of tenants) {
        try {
          const resumen = await /* NOSONAR */ this.servicio.conciliarTenant(
            id,
            this.configuracion,
            ahora,
          );
          total.revisados += resumen.revisados;
          total.emitidos += resumen.emitidos;
          total.fallidos += resumen.fallidos;
        } catch (error) {
          errores++;
          this.logger.error(
            `Conciliación de CFE: falló en el tenant ${id}: ${(error as Error).message}`,
          );
        }
      }

      if (total.revisados > 0 || errores > 0) {
        this.logger.log({
          message: `Conciliación de CFE: ${total.revisados} reintentados, ${total.emitidos} emitidos, ${total.fallidos} fallidos, ${errores} establecimientos con error`,
          ...total,
          errores,
        });
      }
    } catch (error) {
      this.logger.error(
        `Conciliación de CFE: no se pudo ejecutar: ${(error as Error).message}`,
      );
    } finally {
      this.enCurso = false;
    }
    return total;
  }
}
