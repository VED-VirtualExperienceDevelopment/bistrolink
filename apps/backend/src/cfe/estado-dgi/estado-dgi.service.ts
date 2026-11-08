import { Injectable, Logger } from '@nestjs/common';
import { CfeEstadoDgi } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CfeEmitidoConEstado, SurtecClient } from '../surtec.client';
import {
  claveSerieNumero,
  esEstadoDefinitivo,
  estadoDgiDesdeCodigo,
  fechaUruguay,
} from './estado-dgi';

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ResumenEstadoDgi {
  /** CFE PENDIENTES consultados. */
  revisados: number;
  /** Pasaron a un estado definitivo. */
  actualizados: number;
  /** De esos, rechazados por DGI. */
  rechazados: number;
  /** Pendientes que Surtec no devolvió en la consulta (ni por id ni por serie y número). */
  noEncontrados: number;
  /** Pendientes que Surtec devolvió sin respuesta de DGI todavía. */
  sinRespuestaDgi: number;
}

export function resumenEstadoDgiVacio(): ResumenEstadoDgi {
  return {
    revisados: 0,
    actualizados: 0,
    rechazados: 0,
    noEncontrados: 0,
    sinRespuestaDgi: 0,
  };
}

/**
 * HU-009 (BL-455): actualiza el estado ante la DGI de los CFE PENDIENTES de
 * un establecimiento.
 *
 * 1. Lee, dentro del tenant (RLS), los comprobantes de Surtec PENDIENTES
 *    emitidos en los últimos `dias`.
 * 2. Una sola consulta a Surtec por el rango de fechas (hora de Uruguay),
 *    con el RUT del establecimiento como emisor.
 * 3. Empareja por el id de Surtec (proveedor_ref) y, si no está, por serie y
 *    número. Guarda el estado con un UPDATE condicionado a PENDIENTE: dos
 *    corridas a la vez no lo cambian dos veces.
 *
 * Un CFE que Surtec no devuelve, o sin respuesta de DGI, sigue PENDIENTE.
 * Si Surtec falla, lanza: el job lo registra y sigue con el próximo local.
 */
@Injectable()
export class EstadoDgiService {
  private readonly logger = new Logger(EstadoDgiService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly surtec: SurtecClient,
  ) {}

  async actualizarTenant(
    tenantId: string,
    dias: number,
    ahora: Date = new Date(),
  ): Promise<ResumenEstadoDgi> {
    const resumen = resumenEstadoDgiVacio();
    if (!this.surtec.configurado()) return resumen;

    const desde = new Date(ahora.getTime() - dias * DIA_MS);
    const { pendientes, rut } = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => ({
        pendientes: await tx.comprobanteFiscal.findMany({
          where: {
            proveedor: 'SURTEC',
            estadoDgi: 'PENDIENTE',
            fechaEmision: { gte: desde },
          },
          select: {
            id: true,
            proveedorRef: true,
            serie: true,
            numero: true,
            fechaEmision: true,
          },
          orderBy: { fechaEmision: 'asc' },
        }),
        rut: (
          await tx.tenant.findUnique({
            where: { id: tenantId },
            select: { rut: true },
          })
        )?.rut,
      }),
    );
    if (pendientes.length === 0 || !rut) return resumen;
    resumen.revisados = pendientes.length;

    const emitidos = await this.surtec.consultarEmitidos({
      rutEmisor: rut,
      fechaDesde: fechaUruguay(pendientes[0].fechaEmision),
      fechaHasta: fechaUruguay(ahora),
    });
    const porId = new Map(emitidos.map((e) => [e.id, e]));
    const porSerieNumero = new Map(
      emitidos.map((e) => [claveSerieNumero(e.serie, e.numero), e]),
    );

    const noEncontrados: string[] = [];
    const cambios = pendientes.flatMap((c) => {
      const emitido: CfeEmitidoConEstado | undefined =
        (c.proveedorRef ? porId.get(c.proveedorRef) : undefined) ??
        porSerieNumero.get(claveSerieNumero(c.serie, c.numero));
      if (!emitido) {
        noEncontrados.push(`${c.serie}-${c.numero}`);
        return [];
      }
      const estado = estadoDgiDesdeCodigo(emitido.codigoDgi);
      if (!esEstadoDefinitivo(estado)) {
        resumen.sinRespuestaDgi++;
        return [];
      }
      return [{ id: c.id, estado, motivo: emitido.motivoDgi }];
    });
    resumen.noEncontrados = noEncontrados.length;
    // Para diagnosticar en staging sin correr nada a mano: qué devolvió
    // Surtec y qué no se encontró (serie y número, sin datos personales).
    if (noEncontrados.length > 0) {
      this.logger.warn(
        `Estado DGI del tenant ${tenantId}: Surtec devolvió ${emitidos.length} CFE y no están ${noEncontrados.slice(0, 10).join(', ')}${noEncontrados.length > 10 ? '…' : ''}`,
      );
    }
    if (cambios.length === 0) return resumen;

    const aplicados = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const resultado: { id: string; estado: CfeEstadoDgi }[] = [];
        // Secuencial a propósito: pocos por corrida y una sola conexión.
        for (const cambio of cambios) {
          const { count } = await /* NOSONAR */ tx.comprobanteFiscal.updateMany(
            {
              where: { id: cambio.id, estadoDgi: 'PENDIENTE' },
              data: {
                estadoDgi: cambio.estado,
                estadoDgiMotivo: cambio.motivo?.slice(0, 200) ?? null,
                estadoDgiActualizadoEn: ahora,
              },
            },
          );
          if (count > 0) resultado.push(cambio);
        }
        return resultado;
      },
    );

    resumen.actualizados = aplicados.length;
    for (const { id, estado } of aplicados) {
      if (estado === 'RECHAZADO') {
        resumen.rechazados++;
        // Un rechazo de DGI hay que mirarlo: va al log como advertencia.
        this.logger.warn(
          `CFE ${id} del tenant ${tenantId}: DGI lo rechazó (BE)`,
        );
      }
    }
    return resumen;
  }
}
