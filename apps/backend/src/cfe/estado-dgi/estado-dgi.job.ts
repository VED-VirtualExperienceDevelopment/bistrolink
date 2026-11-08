import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PrismaRuntimeClient } from '../../prisma/prisma-runtime.client';
import {
  EstadoDgiService,
  ResumenEstadoDgi,
  resumenEstadoDgiVacio,
} from './estado-dgi.service';
import {
  ConfiguracionEstadoDgi,
  configuracionEstadoDgi,
} from './configuracion-estado-dgi';

/**
 * HU-009 (BL-455): consulta cada `intervaloMs` el estado ante la DGI de los
 * CFE PENDIENTES, establecimiento por establecimiento. Modelo de BL-212:
 * emisión sincrónica y polling, sin webhooks.
 *
 * Mismo esquema que ConciliacionPagosJob (BL-202): timer de Node con
 * unref(), nunca dos corridas a la vez en el mismo proceso, la lista de
 * establecimientos sale de `tenant` (sin RLS) y cada comprobante se lee y se
 * cambia dentro de su tenant. Con varias réplicas es seguro: el UPDATE va
 * condicionado a PENDIENTE.
 */
@Injectable()
export class EstadoDgiJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EstadoDgiJob.name);
  private readonly configuracion: ConfiguracionEstadoDgi =
    configuracionEstadoDgi(process.env);
  private readonly contextId = ContextIdFactory.create();
  private servicio?: EstadoDgiService;
  private timer?: NodeJS.Timeout;
  private enCurso = false;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaRuntimeClient,
  ) {}

  onApplicationBootstrap(): void {
    const { habilitada, intervaloMs, dias } = this.configuracion;
    if (!habilitada) {
      this.logger.log('Estado de los CFE ante la DGI: deshabilitado');
      return;
    }
    this.timer = setInterval(() => {
      void this.ejecutar();
    }, intervaloMs);
    this.timer.unref();
    this.logger.log(
      `Estado de los CFE ante la DGI: cada ${intervaloMs / 60_000} min, los de los últimos ${dias} días`,
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
  async ejecutar(ahora: Date = new Date()): Promise<ResumenEstadoDgi | null> {
    if (this.enCurso) return null;
    this.enCurso = true;
    const total = resumenEstadoDgiVacio();
    let errores = 0;
    try {
      this.servicio ??= await this.moduleRef.resolve(
        EstadoDgiService,
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
          const resumen = await /* NOSONAR */ this.servicio.actualizarTenant(
            id,
            this.configuracion.dias,
            ahora,
          );
          total.revisados += resumen.revisados;
          total.actualizados += resumen.actualizados;
          total.rechazados += resumen.rechazados;
          total.noEncontrados += resumen.noEncontrados;
          total.sinRespuestaDgi += resumen.sinRespuestaDgi;
        } catch (error) {
          errores++;
          this.logger.error(
            `Estado de los CFE ante la DGI: falló en el tenant ${id}: ${(error as Error).message}`,
          );
        }
      }

      if (total.revisados > 0 || errores > 0) {
        this.logger.log({
          message: `Estado de los CFE ante la DGI: ${total.revisados} revisados, ${total.actualizados} actualizados, ${total.rechazados} rechazados, ${total.sinRespuestaDgi} sin respuesta de DGI, ${total.noEncontrados} no encontrados en Surtec, ${errores} establecimientos con error`,
          ...total,
          errores,
        });
      }
    } catch (error) {
      this.logger.error(
        `Estado de los CFE ante la DGI: no se pudo ejecutar: ${(error as Error).message}`,
      );
    } finally {
      this.enCurso = false;
    }
    return total;
  }
}
