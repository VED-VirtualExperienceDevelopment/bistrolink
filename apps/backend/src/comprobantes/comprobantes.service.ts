import { BadRequestException, Injectable } from '@nestjs/common';
import { CfeEstadoDgi, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { fechaUruguay } from '../cfe/estado-dgi/estado-dgi';
import { ConsultarComprobantesDto } from './dto/consultar-comprobantes.dto';

export const TAMANO_PAGINA_COMPROBANTES = 50;
/** Rango máximo de una consulta: un año. */
export const MAXIMO_DIAS_CONSULTA = 366;

const DIA_MS = 24 * 60 * 60 * 1000;
// Uruguay no tiene horario de verano desde 2015: siempre UTC−03:00.
const OFFSET_URUGUAY = '-03:00';

export interface ComprobanteVista {
  id: string;
  fechaEmision: string;
  /** '101' e-Ticket o '111' e-Factura. */
  tipoCfe: string;
  serie: string;
  numero: number;
  pedidoId: string;
  /** Número de mesa; null en un pedido para retirar. */
  mesa: number | null;
  canal: string;
  /** Monto del pago (o la suma del pedido si no tiene pago), con 2 decimales. */
  monto: string;
  estadoDgi: CfeEstadoDgi;
  estadoDgiMotivo: string | null;
  urlConsulta: string | null;
}

export interface PaginaComprobantes {
  comprobantes: ComprobanteVista[];
  desde: string;
  hasta: string;
  pagina: number;
  hayMas: boolean;
}

/**
 * Inicio del día AAAA-MM-DD en Uruguay. Una fecha que no existe (31/02) da
 * una fecha inválida: el motor de JS la «corre» al mes siguiente, así que se
 * comprueba que vuelva a dar el mismo día.
 */
function inicioDelDia(fecha: string): Date {
  const inicio = new Date(`${fecha}T00:00:00${OFFSET_URUGUAY}`);
  return !Number.isNaN(inicio.getTime()) && fechaUruguay(inicio) === fecha
    ? inicio
    : new Date(Number.NaN);
}

/**
 * HU-009 (BL-455): listado de los comprobantes del establecimiento para el
 * administrador, con su estado ante la DGI. Siempre dentro del tenant del
 * token (RLS). Sin datos del receptor de la e-Factura: no hacen falta para
 * el listado y así no se exponen.
 */
@Injectable()
export class ComprobantesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async consultar(
    tenantId: string,
    filtros: ConsultarComprobantesDto,
    ahora: Date = new Date(),
  ): Promise<PaginaComprobantes> {
    const hoy = fechaUruguay(ahora);
    const desde = filtros.desde ?? filtros.hasta ?? hoy;
    const hasta = filtros.hasta ?? (filtros.desde ? hoy : desde);
    const inicio = inicioDelDia(desde);
    // Exclusivo: el día siguiente a «hasta» a las 00:00.
    const fin = new Date(inicioDelDia(hasta).getTime() + DIA_MS);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      throw new BadRequestException('Fecha inválida');
    }
    if (inicio >= fin) {
      throw new BadRequestException(
        'La fecha «desde» tiene que ser anterior o igual a «hasta»',
      );
    }
    if (fin.getTime() - inicio.getTime() > MAXIMO_DIAS_CONSULTA * DIA_MS) {
      throw new BadRequestException(
        `El rango no puede ser de más de ${MAXIMO_DIAS_CONSULTA} días`,
      );
    }
    const pagina = filtros.pagina ?? 1;

    const where: Prisma.ComprobanteFiscalWhereInput = {
      fechaEmision: { gte: inicio, lt: fin },
      ...(filtros.estado ? { estadoDgi: filtros.estado } : {}),
    };

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      // Uno de más, para saber si hay otra página sin contar todo.
      const filas = await tx.comprobanteFiscal.findMany({
        where,
        orderBy: [{ fechaEmision: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * TAMANO_PAGINA_COMPROBANTES,
        take: TAMANO_PAGINA_COMPROBANTES + 1,
        select: {
          id: true,
          fechaEmision: true,
          tipoCfe: true,
          serie: true,
          numero: true,
          pedidoId: true,
          estadoDgi: true,
          estadoDgiMotivo: true,
          urlConsulta: true,
          pago: { select: { monto: true } },
          pedido: {
            select: {
              canal: true,
              mesa: { select: { numero: true, esVirtual: true } },
              lineas: { select: { subtotal: true } },
            },
          },
        },
      });
      const hayMas = filas.length > TAMANO_PAGINA_COMPROBANTES;

      return {
        desde,
        hasta,
        pagina,
        hayMas,
        comprobantes: filas.slice(0, TAMANO_PAGINA_COMPROBANTES).map((c) => ({
          id: c.id,
          fechaEmision: c.fechaEmision.toISOString(),
          tipoCfe: c.tipoCfe,
          serie: c.serie,
          numero: c.numero,
          pedidoId: c.pedidoId,
          mesa: c.pedido.mesa.esVirtual ? null : c.pedido.mesa.numero,
          canal: c.pedido.canal,
          monto: (
            c.pago?.monto ??
            c.pedido.lineas.reduce(
              (total, l) => total.plus(l.subtotal),
              new Prisma.Decimal(0),
            )
          ).toFixed(2),
          estadoDgi: c.estadoDgi,
          estadoDgiMotivo: c.estadoDgiMotivo,
          urlConsulta: c.urlConsulta,
        })),
      };
    });
  }
}
