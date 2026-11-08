import { Injectable, Logger } from '@nestjs/common';
import { CfeEstadoDgi } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CfeEmitidoConEstado, SurtecClient } from '../surtec.client';
import { configuracionEstadoDgi } from './configuracion-estado-dgi';
import { esEstadoDefinitivo, estadoDgiDesdeCodigo } from './estado-dgi';

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ResumenEstadoDgi {
  /** CFE PENDIENTES consultados. */
  revisados: number;
  /** Pasaron a un estado definitivo. */
  actualizados: number;
  /** De esos, rechazados por DGI. */
  rechazados: number;
  /** Pendientes que Surtec no devolvió (ni por id de Surtec ni por id_externo). */
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
 *    emitidos en los últimos `dias`: hasta `maxPorCorrida`, los más nuevos
 *    primero.
 * 2. Consulta cada uno en la API v2 de Surtec (BL-471), con el RUT del
 *    establecimiento como emisor: por el id de Surtec (proveedor_ref) o, si
 *    no está, por el id_externo. Uno por vez y con una pausa entre llamadas
 *    (límite de Surtec: 120 por minuto).
 * 3. Guarda el estado con un UPDATE condicionado a PENDIENTE: dos corridas
 *    a la vez no lo cambian dos veces.
 *
 * Un CFE que Surtec no devuelve, o sin respuesta de DGI, sigue PENDIENTE.
 * Si Surtec falla, lanza: el job lo registra y sigue con el próximo local.
 */
@Injectable()
export class EstadoDgiService {
  private readonly logger = new Logger(EstadoDgiService.name);
  private readonly configuracion = configuracionEstadoDgi(process.env);

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
            idExterno: true,
            serie: true,
            numero: true,
          },
          orderBy: { fechaEmision: 'desc' },
          take: this.configuracion.maxPorCorrida,
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

    const noEncontrados: string[] = [];
    const cambios: {
      id: string;
      estado: CfeEstadoDgi;
      motivo: string | null;
    }[] = [];
    // Secuencial a propósito (Sonar S9382): una consulta por vez, con pausa,
    // para no pasar el límite de Surtec.
    for (const [indice, c] of pendientes.entries()) {
      if (indice > 0 && this.configuracion.pausaMs > 0) {
        await /* NOSONAR */ this.esperar(this.configuracion.pausaMs);
      }
      const emitido = await /* NOSONAR */ this.buscarEnSurtec(rut, c);
      if (!emitido) {
        noEncontrados.push(`${c.serie}-${c.numero}`);
        continue;
      }
      const estado = estadoDgiDesdeCodigo(emitido.codigoDgi);
      if (esEstadoDefinitivo(estado)) {
        cambios.push({ id: c.id, estado, motivo: emitido.motivoDgi });
      } else {
        resumen.sinRespuestaDgi++;
      }
    }
    resumen.noEncontrados = noEncontrados.length;
    // Para diagnosticar en staging sin correr nada a mano: qué devolvió
    // Surtec y qué no se encontró (serie y número, sin datos personales).
    if (noEncontrados.length > 0) {
      this.logger.warn(
        `Estado DGI del tenant ${tenantId}: Surtec no tiene ${noEncontrados.length} de ${pendientes.length} CFE consultados: ${noEncontrados.slice(0, 10).join(', ')}${noEncontrados.length > 10 ? '…' : ''}`,
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

  /** Por el id de Surtec y, si no está, por el id_externo. */
  private buscarEnSurtec(
    rut: string,
    comprobante: { proveedorRef: string | null; idExterno: string | null },
  ): Promise<CfeEmitidoConEstado | null> {
    if (comprobante.proveedorRef) {
      return this.surtec.consultarEmitido(rut, comprobante.proveedorRef);
    }
    if (comprobante.idExterno) {
      return this.surtec.buscarEmitidoPorIdExterno(rut, comprobante.idExterno);
    }
    return Promise.resolve(null);
  }

  /** Pausa entre consultas a Surtec (se reemplaza en los tests). */
  protected esperar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
