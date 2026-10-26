import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import {
  ConciliacionPagosService,
  ResumenConciliacion,
  resumenVacio,
} from './conciliacion-pagos.service';
import {
  ConfiguracionConciliacion,
  configuracionConciliacion,
} from './configuracion-conciliacion';

/**
 * HU-032 (BL-202): corre la conciliación de pagos pendientes cada
 * `intervaloMs`, establecimiento por establecimiento.
 *
 * - Un timer de Node (sin dependencias nuevas): alcanza para un job cada un
 *   minuto. `unref()` para que no impida apagar el proceso.
 * - Nunca hay dos corridas a la vez en el mismo proceso: si una se alarga,
 *   la siguiente se saltea. Con varias réplicas de la API también es seguro:
 *   cada cambio se aplica con un UPDATE condicionado al estado PENDIENTE, así
 *   que dos corridas simultáneas no aplican el mismo cambio dos veces.
 * - La lista de establecimientos sale de `tenant`, que no tiene RLS (igual
 *   que TenantEstadoService); cada pago se lee y se cambia DENTRO del
 *   contexto de su tenant, con el rol de runtime (RLS activo).
 * - ConciliacionPagosService depende de TenantPrismaService, que es por
 *   request: se resuelve una sola vez con un contexto propio del job y se
 *   reutiliza en cada corrida (así no se crea un PrismaClient por corrida).
 */
@Injectable()
export class ConciliacionPagosJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ConciliacionPagosJob.name);
  private readonly configuracion: ConfiguracionConciliacion =
    configuracionConciliacion(process.env);
  private readonly contextId = ContextIdFactory.create();
  private prisma?: PrismaClient;
  private servicio?: ConciliacionPagosService;
  private timer?: NodeJS.Timeout;
  private enCurso = false;

  constructor(private readonly moduleRef: ModuleRef) {}

  onApplicationBootstrap(): void {
    const { habilitada, intervaloMs, conciliarDespuesMs, vencerDespuesMs } =
      this.configuracion;
    if (!habilitada) {
      this.logger.log('Conciliación de pagos pendientes: deshabilitada');
      return;
    }
    this.timer = setInterval(() => {
      void this.ejecutar();
    }, intervaloMs);
    this.timer.unref();
    this.logger.log(
      `Conciliación de pagos pendientes: cada ${intervaloMs / 1000} s (consulta a los ${conciliarDespuesMs / 60_000} min, vence a los ${vencerDespuesMs / 60_000} min)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.prisma?.$disconnect();
  }

  /**
   * Una corrida sobre todos los establecimientos. Devuelve null si ya había
   * una en curso. Nunca lanza: un error de un establecimiento queda en el log
   * y no frena a los demás.
   */
  async ejecutar(
    ahora: Date = new Date(),
  ): Promise<ResumenConciliacion | null> {
    if (this.enCurso) {
      return null;
    }
    this.enCurso = true;
    const total = resumenVacio();
    try {
      this.prisma ??= new PrismaClient({
        datasourceUrl: process.env.RUNTIME_DATABASE_URL,
      });
      this.servicio ??= await this.moduleRef.resolve(
        ConciliacionPagosService,
        this.contextId,
        { strict: false },
      );
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
      });

      for (const { id } of tenants) {
        try {
          const resumen = await this.servicio.conciliarTenant(
            id,
            this.configuracion,
            ahora,
          );
          total.revisados += resumen.revisados;
          total.conciliados += resumen.conciliados;
          total.vencidos += resumen.vencidos;
          total.errores += resumen.errores;
        } catch (error) {
          total.errores++;
          this.logger.error(
            `Conciliación de pagos: falló en el tenant ${id}: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }

      // Solo se registra la corrida si encontró algo: una línea por minuto
      // sin novedades no le sirve a nadie.
      if (total.revisados > 0 || total.errores > 0) {
        this.logger.log({
          message: `Conciliación de pagos: ${total.revisados} revisados, ${total.conciliados} conciliados, ${total.vencidos} vencidos, ${total.errores} con error`,
          ...total,
        });
      }
    } catch (error) {
      this.logger.error(
        `Conciliación de pagos: no se pudo ejecutar: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.enCurso = false;
    }
    return total;
  }
}
