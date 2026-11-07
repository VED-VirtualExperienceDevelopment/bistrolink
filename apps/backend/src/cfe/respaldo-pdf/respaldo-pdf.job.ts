import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PrismaRuntimeClient } from '../../prisma/prisma-runtime.client';
import {
  RespaldoPdfService,
  ResumenRespaldoPdf,
  resumenRespaldoPdfVacio,
} from './respaldo-pdf.service';
import {
  ConfiguracionRespaldoPdf,
  configuracionRespaldoPdf,
} from './configuracion-respaldo-pdf';

/**
 * HU-009 (BL-454): cada `intervaloMs` guarda en S3 el PDF de los CFE que
 * todavía no lo tienen, establecimiento por establecimiento.
 *
 * Mismo esquema que RespaldoPdfJob: timer de Node con unref(), nunca dos
 * corridas a la vez en el mismo proceso, la lista de establecimientos sale
 * de `tenant` (sin RLS) y cada comprobante se lee dentro de su tenant. Con
 * varias réplicas es seguro: la clave del objeto es fija por comprobante, así
 * que guardarlo dos veces deja el mismo archivo.
 */
@Injectable()
export class RespaldoPdfJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RespaldoPdfJob.name);
  private readonly configuracion: ConfiguracionRespaldoPdf =
    configuracionRespaldoPdf(process.env);
  private readonly contextId = ContextIdFactory.create();
  private servicio?: RespaldoPdfService;
  private timer?: NodeJS.Timeout;
  private enCurso = false;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaRuntimeClient,
  ) {}

  onApplicationBootstrap(): void {
    const { habilitado, intervaloMs, dias, maxIntentos } = this.configuracion;
    if (!habilitado) {
      this.logger.log('Respaldo del PDF de los CFE: deshabilitado');
      return;
    }
    this.timer = setInterval(() => {
      void this.ejecutar();
    }, intervaloMs);
    this.timer.unref();
    this.logger.log(
      `Respaldo del PDF de los CFE: cada ${intervaloMs / 60_000} min, comprobantes de los últimos ${dias} días, hasta ${maxIntentos} intentos`,
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
  async ejecutar(ahora: Date = new Date()): Promise<ResumenRespaldoPdf | null> {
    if (this.enCurso) return null;
    this.enCurso = true;
    const total = resumenRespaldoPdfVacio();
    let errores = 0;
    try {
      this.servicio ??= await this.moduleRef.resolve(
        RespaldoPdfService,
        this.contextId,
        { strict: false },
      );
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
      });

      // Secuencial a propósito (Sonar S9382): un establecimiento por vez,
      // sin ráfagas a Surtec (120 consultas por minuto) ni varias conexiones del pool único (BL-430).
      for (const { id } of tenants) {
        try {
          const resumen = await /* NOSONAR */ this.servicio.respaldarTenant(
            id,
            this.configuracion,
            ahora,
          );
          total.revisados += resumen.revisados;
          total.guardados += resumen.guardados;
          total.fallidos += resumen.fallidos;
        } catch (error) {
          errores++;
          this.logger.error(
            `Respaldo del PDF: falló en el tenant ${id}: ${(error as Error).message}`,
          );
        }
      }

      if (total.revisados > 0 || errores > 0) {
        this.logger.log({
          message: `Respaldo del PDF: ${total.revisados} revisados, ${total.guardados} guardados, ${total.fallidos} fallidos, ${errores} establecimientos con error`,
          ...total,
          errores,
        });
      }
    } catch (error) {
      this.logger.error(
        `Respaldo del PDF: no se pudo ejecutar: ${(error as Error).message}`,
      );
    } finally {
      this.enCurso = false;
    }
    return total;
  }
}
