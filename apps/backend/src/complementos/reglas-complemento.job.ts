import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PrismaRuntimeClient } from '../prisma/prisma-runtime.client';
import {
  ConfiguracionReglasComplemento,
  configuracionReglasComplemento,
  tocaRecalcular,
} from './configuracion-reglas-complemento';
import { ReglasComplementoService } from './reglas-complemento.service';

/** Resultado de una corrida del job. */
export interface CorridaReglasComplemento {
  establecimientos: number;
  errores: number;
}

/**
 * HU-046 (BL-552): recalcula una vez por día, de madrugada, las reglas de
 * complemento de cada establecimiento. Mismo esquema que ResumenVentasJob
 * (HU-012):
 *
 * - Un timer de Node (sin dependencias nuevas), con `unref()`. Revisa cada
 *   15 minutos si ya toca (configuracion-reglas-complemento.ts).
 * - Nunca hay dos corridas a la vez en el mismo proceso. Con varias réplicas
 *   también es seguro: el recálculo es idempotente y toma un candado por
 *   tenant.
 * - La lista de establecimientos sale de `tenant` (sin RLS); las reglas se
 *   escriben dentro del contexto de cada tenant (RLS activo).
 * - Solo se registran los fallos: un establecimiento que falla no frena a
 *   los demás, y al otro día se vuelve a intentar.
 */
@Injectable()
export class ReglasComplementoJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ReglasComplementoJob.name);
  private readonly configuracion: ConfiguracionReglasComplemento =
    configuracionReglasComplemento(process.env);
  private readonly contextId = ContextIdFactory.create();
  private servicio?: ReglasComplementoService;
  private timer?: NodeJS.Timeout;
  private enCurso = false;
  private ultimaFecha: string | null = null;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaRuntimeClient,
  ) {}

  onApplicationBootstrap(): void {
    const { habilitado, chequeoMs, hora } = this.configuracion;
    if (!habilitado) {
      this.logger.log('Reglas de complemento: job deshabilitado');
      return;
    }
    this.timer = setInterval(() => {
      void this.siToca();
    }, chequeoMs);
    this.timer.unref();
    this.logger.log(`Reglas de complemento: cada día desde las ${hora} h`);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Corre si ya pasó la hora y hoy todavía no corrió. */
  async siToca(
    ahora: Date = new Date(),
  ): Promise<CorridaReglasComplemento | null> {
    const { toca, fecha } = tocaRecalcular(
      ahora,
      this.configuracion,
      this.ultimaFecha,
    );
    if (!toca || this.enCurso) return null;
    const corrida = await this.ejecutar(ahora);
    // Se recuerda el día aunque algún local falle: se reintenta mañana, y
    // no cada 15 minutos.
    if (corrida) this.ultimaFecha = fecha;
    return corrida;
  }

  /**
   * Una corrida sobre todos los establecimientos. Devuelve null si ya había
   * una en curso. Nunca lanza.
   */
  async ejecutar(
    ahora: Date = new Date(),
  ): Promise<CorridaReglasComplemento | null> {
    if (this.enCurso) {
      return null;
    }
    this.enCurso = true;
    const corrida: CorridaReglasComplemento = {
      establecimientos: 0,
      errores: 0,
    };
    try {
      this.servicio ??= await this.moduleRef.resolve(
        ReglasComplementoService,
        this.contextId,
        { strict: false },
      );
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
      });

      // Secuencial a propósito (Sonar S9382): un establecimiento por vez,
      // para no ocupar varias conexiones del pool único (BL-430).
      for (const { id } of tenants) {
        try {
          await /* NOSONAR */ this.servicio.recalcular(id, ahora);
          corrida.establecimientos++;
        } catch (error) {
          corrida.errores++;
          this.logger.error(
            `Reglas de complemento: falló en el tenant ${id}: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }

      if (corrida.errores > 0) {
        this.logger.warn({
          message: `Reglas de complemento: ${corrida.establecimientos} establecimientos recalculados, ${corrida.errores} con error`,
          ...corrida,
        });
      }
    } catch (error) {
      this.logger.error(
        `Reglas de complemento: no se pudo ejecutar: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.enCurso = false;
    }
    return corrida;
  }
}
