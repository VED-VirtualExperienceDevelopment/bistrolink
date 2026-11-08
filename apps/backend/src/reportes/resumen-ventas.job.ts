import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PrismaRuntimeClient } from '../prisma/prisma-runtime.client';
import {
  ConfiguracionResumenVentas,
  configuracionResumenVentas,
} from './configuracion-resumen-ventas';
import {
  ResumenVentasService,
  ventanaReciente,
} from './resumen-ventas.service';

/** Resultado de una corrida del job. */
export interface CorridaResumenVentas {
  establecimientos: number;
  errores: number;
}

/**
 * HU-012 (BL-219): recalcula el resumen de ventas de las últimas horas, cada
 * `intervaloMs`, establecimiento por establecimiento. Mismo esquema que
 * ConciliacionPagosJob (HU-032):
 *
 * - Un timer de Node (sin dependencias nuevas), con `unref()` para que no
 *   impida apagar el proceso.
 * - Nunca hay dos corridas a la vez en el mismo proceso. Con varias réplicas
 *   también es seguro: el recálculo es idempotente y toma un candado por
 *   tenant.
 * - La lista de establecimientos sale de `tenant` (sin RLS); cada resumen se
 *   escribe dentro del contexto de su tenant (RLS activo).
 * - ResumenVentasService depende de TenantPrismaService (por request): se
 *   resuelve una sola vez con un contexto propio del job.
 */
@Injectable()
export class ResumenVentasJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ResumenVentasJob.name);
  private readonly configuracion: ConfiguracionResumenVentas =
    configuracionResumenVentas(process.env);
  private readonly contextId = ContextIdFactory.create();
  private servicio?: ResumenVentasService;
  private timer?: NodeJS.Timeout;
  private enCurso = false;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaRuntimeClient,
  ) {}

  onApplicationBootstrap(): void {
    const { habilitado, intervaloMs, ventanaHoras } = this.configuracion;
    if (!habilitado) {
      this.logger.log('Resumen de ventas: job deshabilitado');
      return;
    }
    this.timer = setInterval(() => {
      void this.ejecutar();
    }, intervaloMs);
    this.timer.unref();
    this.logger.log(
      `Resumen de ventas: cada ${intervaloMs / 60_000} min, últimas ${ventanaHoras} h`,
    );
  }

  // El pool lo cierra PrismaRuntimeClient; acá solo se apaga el timer.
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
  ): Promise<CorridaResumenVentas | null> {
    if (this.enCurso) {
      return null;
    }
    this.enCurso = true;
    const corrida: CorridaResumenVentas = { establecimientos: 0, errores: 0 };
    try {
      this.servicio ??= await this.moduleRef.resolve(
        ResumenVentasService,
        this.contextId,
        { strict: false },
      );
      const ventana = ventanaReciente(ahora, this.configuracion.ventanaHoras);
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
      });

      // Secuencial a propósito (Sonar S9382): un establecimiento por vez,
      // para no ocupar varias conexiones del pool único (BL-430).
      for (const { id } of tenants) {
        try {
          await /* NOSONAR */ this.servicio.recalcularVentana(id, ventana);
          corrida.establecimientos++;
        } catch (error) {
          corrida.errores++;
          this.logger.error(
            `Resumen de ventas: falló en el tenant ${id}: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }

      // Solo se registra la corrida si algo falló: una línea cada 15 min
      // sin novedades no le sirve a nadie.
      if (corrida.errores > 0) {
        this.logger.warn({
          message: `Resumen de ventas: ${corrida.establecimientos} establecimientos recalculados, ${corrida.errores} con error`,
          ...corrida,
        });
      }
    } catch (error) {
      this.logger.error(
        `Resumen de ventas: no se pudo ejecutar: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.enCurso = false;
    }
    return corrida;
  }
}
