import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CfeService } from '../cfe.service';
import { ConfiguracionConciliacionCfe } from './configuracion-conciliacion-cfe';
import { ESPERA_INICIAL_MS, tocaReintentar } from './reintentos-cfe';

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ResumenConciliacionCfe {
  /** Pagos aprobados sin CFE a los que les tocaba un intento. */
  revisados: number;
  /** Se emitió el CFE. */
  emitidos: number;
  /** El intento volvió a fallar (queda registrado en el pago). */
  fallidos: number;
}

export function resumenConciliacionCfeVacio(): ResumenConciliacionCfe {
  return { revisados: 0, emitidos: 0, fallidos: 0 };
}

/**
 * HU-023 (BL-96): reintenta la emisión de los CFE pendientes de un
 * establecimiento: pagos APROBADOS sin comprobante.
 *
 * 1. Lee, dentro del tenant (RLS), los aprobados de los últimos `dias` sin
 *    comprobante y con menos de `maxIntentos` fallidos (los más viejos
 *    primero).
 * 2. Se queda con los que les toca (reintentos-cfe.ts) y reintenta hasta
 *    `lote`, de a uno. CfeService.reintentar no duplica: usa el mismo
 *    id_externo (Surtec devuelve el mismo CFE) y el upsert por id_externo.
 *
 * El cobro ya está hecho: el comensal no espera nada de esto (su pantalla
 * muestra el comprobante cuando aparece).
 */
@Injectable()
export class ConciliacionCfeService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly cfe: CfeService,
  ) {}

  async conciliarTenant(
    tenantId: string,
    configuracion: Pick<
      ConfiguracionConciliacionCfe,
      'dias' | 'maxIntentos' | 'lote'
    >,
    ahora: Date = new Date(),
  ): Promise<ResumenConciliacionCfe> {
    if (!this.cfe.configurado()) return resumenConciliacionCfeVacio();

    const candidatos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        tx.pago.findMany({
          where: {
            estado: 'APROBADO',
            comprobantes: { none: {} },
            cfeIntentos: { lt: configuracion.maxIntentos },
            createdAt: {
              gte: new Date(ahora.getTime() - configuracion.dias * DIA_MS),
              lte: new Date(ahora.getTime() - ESPERA_INICIAL_MS),
            },
          },
          select: {
            id: true,
            createdAt: true,
            cfeIntentos: true,
            cfeUltimoIntentoEn: true,
          },
          orderBy: { createdAt: 'asc' },
          // Margen: algunos todavía no les toca por la espera.
          take: configuracion.lote * 5,
        }),
    );

    const aReintentar = candidatos
      .filter((p) => tocaReintentar(p, configuracion, ahora))
      .slice(0, configuracion.lote);

    // Secuencial a propósito: no mandarle ráfagas a Surtec.
    let emitidos = 0;
    for (const { id } of aReintentar) {
      const { comprobante } = await /* NOSONAR */ this.cfe.reintentar(
        tenantId,
        id,
      );
      if (comprobante) emitidos++;
    }
    return {
      revisados: aReintentar.length,
      emitidos,
      fallidos: aReintentar.length - emitidos,
    };
  }
}
