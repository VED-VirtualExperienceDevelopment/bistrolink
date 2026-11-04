import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CfeEstadoDgi, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { fechaUruguay } from '../cfe/estado-dgi/estado-dgi';
import { CfeService, ResumenComprobante } from '../cfe/cfe.service';
import { configuracionConciliacionCfe } from '../cfe/conciliacion-cfe/configuracion-conciliacion-cfe';
import {
  proximoIntento,
  requiereAtencion,
} from '../cfe/conciliacion-cfe/reintentos-cfe';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
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

/** HU-023 (BL-96): un pago aprobado sin CFE (pendiente de emisión). */
export interface PendienteEmisionVista {
  pagoId: string;
  pedidoId: string;
  mesa: number | null;
  canal: string;
  monto: string;
  medioPago: string;
  /** Cuándo se registró el pago. */
  fecha: string;
  intentos: number;
  ultimoIntentoEn: string | null;
  /** Sin datos personales (ver CfeService). */
  ultimoError: string | null;
  /** Ya no se reintenta solo: más de N intentos o de N días. */
  requiereAtencion: boolean;
  /** Próximo intento automático; null si requiere atención. */
  proximoIntentoEn: string | null;
}

export interface PaginaPendientesEmision {
  pendientes: PendienteEmisionVista[];
  /** Total de pagos aprobados sin CFE (para el contador de la pestaña). */
  total: number;
  pagina: number;
  hayMas: boolean;
}

export interface ResultadoReintentoVista {
  emitido: boolean;
  comprobante: ResumenComprobante | null;
  error: string | null;
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
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly cfe: CfeService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * HU-023 (BL-96): pagos APROBADOS sin comprobante, del más viejo al más
   * nuevo, con los intentos, el último error y si requiere atención.
   */
  async consultarPendientes(
    tenantId: string,
    pagina = 1,
    ahora: Date = new Date(),
  ): Promise<PaginaPendientesEmision> {
    const limites = configuracionConciliacionCfe(process.env);
    const where: Prisma.PagoWhereInput = {
      estado: 'APROBADO',
      comprobantes: { none: {} },
    };
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const [total, filas] = await Promise.all([
        tx.pago.count({ where }),
        tx.pago.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (pagina - 1) * TAMANO_PAGINA_COMPROBANTES,
          take: TAMANO_PAGINA_COMPROBANTES + 1,
          select: {
            id: true,
            pedidoId: true,
            monto: true,
            medioPago: true,
            createdAt: true,
            cfeIntentos: true,
            cfeUltimoIntentoEn: true,
            cfeUltimoError: true,
            pedido: {
              select: {
                canal: true,
                mesa: { select: { numero: true, esVirtual: true } },
              },
            },
          },
        }),
      ]);
      return {
        total,
        pagina,
        hayMas: filas.length > TAMANO_PAGINA_COMPROBANTES,
        pendientes: filas.slice(0, TAMANO_PAGINA_COMPROBANTES).map((p) => {
          const proximo = proximoIntento(p, limites, ahora);
          return {
            pagoId: p.id,
            pedidoId: p.pedidoId,
            mesa: p.pedido.mesa.esVirtual ? null : p.pedido.mesa.numero,
            canal: p.pedido.canal,
            monto: p.monto.toFixed(2),
            medioPago: p.medioPago,
            fecha: p.createdAt.toISOString(),
            intentos: p.cfeIntentos,
            ultimoIntentoEn: p.cfeUltimoIntentoEn?.toISOString() ?? null,
            ultimoError: p.cfeUltimoError,
            requiereAtencion: requiereAtencion(p, limites, ahora),
            proximoIntentoEn: proximo?.toISOString() ?? null,
          };
        }),
      };
    });
  }

  /**
   * HU-023 (BL-96): «Reintentar ahora» del administrador, también para los
   * que requieren atención. Solo pagos del tenant (RLS), APROBADOS y sin
   * comprobante. Queda en la auditoría con el resultado.
   */
  async reintentar(
    tenantId: string,
    pagoId: string,
    actor: { id: string },
  ): Promise<ResultadoReintentoVista> {
    const pago = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.pago.findUnique({
        where: { id: pagoId },
        select: { estado: true, _count: { select: { comprobantes: true } } },
      }),
    );
    if (!pago) throw new NotFoundException('Pago no encontrado');
    if (pago.estado !== 'APROBADO') {
      throw new ConflictException('Solo se emite el CFE de un pago aprobado');
    }
    if (pago._count.comprobantes > 0) {
      throw new ConflictException('Este pago ya tiene su comprobante');
    }
    if (!this.cfe.configurado()) {
      throw new ConflictException(
        'La facturación electrónica no está configurada',
      );
    }

    const { comprobante, error } = await this.cfe.reintentar(tenantId, pagoId);
    let resultado = 'SIN_EMITIR';
    if (comprobante) resultado = 'EMITIDO';
    else if (error) resultado = 'FALLIDO';
    this.auditLog.registrar({
      action: AuditAction.PAGO_CFE_REINTENTADO,
      tenantId,
      actorKeycloakId: actor.id,
      entidadId: pagoId,
      detalle: { resultado },
    });
    return { emitido: Boolean(comprobante), comprobante, error };
  }

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
