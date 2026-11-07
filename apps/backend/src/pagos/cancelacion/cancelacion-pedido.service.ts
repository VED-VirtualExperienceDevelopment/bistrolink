import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PedidoEstado, Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PedidosService } from '../../pedidos/pedidos.service';
import { completarCapacidad } from '../../pedidos/cola-kds';
import { CfeService } from '../../cfe/cfe.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../audit-log/audit-action.enum';
import { MercadoPagoGateway } from '../gateways/mercadopago.gateway';
import { MEDIO_EFECTIVO } from '../efectivo/cobro-efectivo.service';
import { CancelarPedidoDto, MOTIVOS_CANCELACION } from './cancelar-pedido.dto';

/** HU-024 (BL-104): estados en los que el personal puede cancelar. */
export const ESTADOS_CANCELABLES: readonly PedidoEstado[] = [
  'RECIBIDO',
  'EN_PREPARACION',
];

/** Medios que BistroLink devuelve solo, por la pasarela. */
const MEDIOS_CON_REEMBOLSO_AUTOMATICO = new Set(['MERCADOPAGO']);
/** Medios que devuelve el mozo a mano (efectivo o anulación en el POS). */
// POS_CREDITO y POS_DEBITO: cobros con el POS del local (HU-007b, BL-80).
const MEDIOS_CON_DEVOLUCION_MANUAL = new Set([
  MEDIO_EFECTIVO,
  'POS_CREDITO',
  'POS_DEBITO',
]);

const NOMBRE_MEDIO: Readonly<Record<string, string>> = {
  MERCADOPAGO: 'Mercado Pago',
  EFECTIVO: 'Efectivo',
  POS_CREDITO: 'Crédito (POS del local)',
  POS_DEBITO: 'Débito (POS del local)',
};

// usuario.keycloak_id es UUID: un actor que no lo es no tiene fila.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DevolucionDelPago {
  pagoId: string;
  medio: string;
  monto: string;
  /** true: la hace BistroLink (Mercado Pago); false: el mozo, a mano. */
  automatica: boolean;
}

/** GET /pedidos/:id/cancelacion: lo que va a pasar si se cancela. */
export interface VistaPreviaCancelacion {
  pedidoId: string;
  estado: PedidoEstado;
  /** Total que se devuelve, con 2 decimales. */
  monto: string;
  /** Null si se puede cancelar; si no, por qué. */
  motivoNoCancelable: string | null;
  devoluciones: DevolucionDelPago[];
  /** El pedido no empezó a prepararse: el stock vuelve. */
  repondraStock: boolean;
}

export interface PedidoCancelado {
  pedidoId: string;
  estado: 'CANCELADO';
  monto: string;
  devoluciones: DevolucionDelPago[];
  stockRepuesto: boolean;
}

type PagoParaDevolver = {
  id: string;
  medioPago: string;
  monto: Prisma.Decimal;
  pasarelaReferencia: string | null;
};

function devolucion(pago: PagoParaDevolver): DevolucionDelPago {
  return {
    pagoId: pago.id,
    medio: pago.medioPago,
    monto: pago.monto.toFixed(2),
    automatica: MEDIOS_CON_REEMBOLSO_AUTOMATICO.has(pago.medioPago),
  };
}

function motivoNoCancelable(
  estado: PedidoEstado,
  pagos: PagoParaDevolver[],
): string | null {
  if (estado === 'CANCELADO') return 'El pedido ya está cancelado';
  if (!ESTADOS_CANCELABLES.includes(estado)) {
    return 'Solo se puede cancelar un pedido recibido o en preparación';
  }
  const sinDevolucion = pagos.find(
    (p) =>
      !MEDIOS_CON_REEMBOLSO_AUTOMATICO.has(p.medioPago) &&
      !MEDIOS_CON_DEVOLUCION_MANUAL.has(p.medioPago),
  );
  if (sinDevolucion) {
    return `No se puede devolver un pago con ${sinDevolucion.medioPago}`;
  }
  return null;
}

/**
 * HU-024 (BL-104): cancelación total de un pedido pagado, con la devolución
 * del pago y la nota de crédito del CFE.
 *
 * 1. Solo un pedido RECIBIDO o EN_PREPARACION (nunca listo ni entregado).
 * 2. Primero se devuelve: Mercado Pago, por la API (reembolso total); el
 *    efectivo y el POS del local, a mano, con la confirmación del mozo. Si
 *    Mercado Pago falla, el pedido NO se cancela (502) y se puede reintentar:
 *    los pagos ya devueltos no se devuelven de nuevo (quedan REEMBOLSADOS).
 * 3. En una transacción: pedido a CANCELADO con quién lo canceló, pagos
 *    manuales a REEMBOLSADO, stock repuesto si cocina todavía no lo empezó,
 *    la cola ocupa el lugar liberado y la auditoría con motivo y montos.
 * 4. Después del commit: el pedido sale del KDS, se avisa a la cola, a los
 *    reportes y a la carta, y se emite la nota de crédito en segundo plano
 *    (si falla, la reintenta la conciliación de CFE).
 */
@Injectable()
export class CancelacionPedidoService {
  private readonly logger = new Logger(CancelacionPedidoService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly pedidos: PedidosService,
    private readonly cfe: CfeService,
    private readonly auditLog: AuditLogService,
    private readonly mercadoPago: MercadoPagoGateway,
  ) {}

  async vistaPrevia(
    tenantId: string,
    pedidoId: string,
  ): Promise<VistaPreviaCancelacion> {
    const pedido = await this.leer(tenantId, pedidoId);
    const pagos = pedido.pagos.filter((p) => p.estado === 'APROBADO');
    return {
      pedidoId: pedido.id,
      estado: pedido.estado,
      monto: sumar(pagos),
      motivoNoCancelable: motivoNoCancelable(pedido.estado, pagos),
      devoluciones: pedido.pagos
        .filter((p) => p.estado !== 'RECHAZADO' && p.estado !== 'PENDIENTE')
        .map(devolucion),
      repondraStock: pedido.estado === 'RECIBIDO',
    };
  }

  async cancelar(
    tenantId: string,
    actorKeycloakId: string,
    pedidoId: string,
    dto: CancelarPedidoDto,
  ): Promise<PedidoCancelado> {
    const pedido = await this.leer(tenantId, pedidoId);
    const aprobados = pedido.pagos.filter((p) => p.estado === 'APROBADO');
    const yaReembolsados = pedido.pagos.filter(
      (p) => p.estado === 'REEMBOLSADO',
    );
    const motivo = motivoNoCancelable(pedido.estado, aprobados);
    if (motivo) throw new ConflictException(motivo);

    const manuales = aprobados.filter((p) =>
      MEDIOS_CON_DEVOLUCION_MANUAL.has(p.medioPago),
    );
    if (manuales.length > 0 && dto.devolucionManualConfirmada !== true) {
      throw new BadRequestException(
        'Confirmá que devolviste el efectivo o anulaste el cobro en el POS del local',
      );
    }

    // 2. Mercado Pago, fuera de la transacción (es una llamada HTTP). Cada
    // pago devuelto queda REEMBOLSADO enseguida: un reintento no lo repite.
    let huboReembolsoAutomatico = false;
    for (const pago of aprobados.filter((p) =>
      MEDIOS_CON_REEMBOLSO_AUTOMATICO.has(p.medioPago),
    )) {
      await /* NOSONAR */ this.reembolsarEnMercadoPago(tenantId, pago);
      huboReembolsoAutomatico = true;
    }

    // 3. La cancelación. Si cocina lo marcó listo mientras se devolvía la
    // plata por Mercado Pago, el pedido se cancela igual: el pago ya volvió.
    const estadosPermitidos: PedidoEstado[] = huboReembolsoAutomatico
      ? [...ESTADOS_CANCELABLES, 'LISTO_PARA_ENTREGAR']
      : [...ESTADOS_CANCELABLES];
    const devueltos = [...aprobados, ...yaReembolsados];
    const devoluciones = devueltos.map(devolucion);
    const monto = sumar(devueltos);
    const resultado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        this.cancelarEnTx(tx, {
          tenantId,
          actorKeycloakId,
          pedidoId,
          estadoAnterior: pedido.estado,
          estadosPermitidos,
          manuales,
          dto,
          monto,
          devoluciones,
          pagos: devueltos.map((p) => p.id),
        }),
    );
    const cancelado: PedidoCancelado = {
      pedidoId,
      estado: 'CANCELADO',
      monto,
      devoluciones,
      stockRepuesto: resultado.stockRepuesto !== null,
    };

    // 4. Después del commit.
    this.pedidos.notificarPedidoCancelado(
      tenantId,
      pedidoId,
      resultado.promovidos,
      resultado.stockRepuesto,
    );
    for (const pago of devueltos) {
      this.cfe.emitirNotaDeCreditoEnSegundoPlano(tenantId, pago.id);
    }
    return cancelado;
  }

  private async leer(tenantId: string, pedidoId: string) {
    const pedido = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.pedido.findUnique({
        where: { id: pedidoId },
        select: {
          id: true,
          estado: true,
          pagos: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              estado: true,
              medioPago: true,
              monto: true,
              pasarelaReferencia: true,
            },
          },
        },
      }),
    );
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return pedido;
  }

  private async reembolsarEnMercadoPago(
    tenantId: string,
    pago: PagoParaDevolver,
  ): Promise<void> {
    if (!pago.pasarelaReferencia) {
      throw new ConflictException(
        'El pago con Mercado Pago no tiene la referencia de la order: no se puede reembolsar',
      );
    }
    try {
      await this.mercadoPago.reembolsarOrden(
        pago.pasarelaReferencia,
        tenantId,
        `reembolso-${pago.id}`,
      );
    } catch (error) {
      this.logger.warn(
        `Cancelación: Mercado Pago no reembolsó el pago ${pago.id}: ${(error as Error).message}`,
      );
      throw new BadGatewayException(
        'Mercado Pago no pudo hacer el reembolso. El pedido no se canceló: probá de nuevo en unos minutos.',
      );
    }
    await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      this.marcarReembolsado(tx, tenantId, pago.id, 'REEMBOLSO_MERCADOPAGO'),
    );
  }

  /** Pago APROBADO → REEMBOLSADO, con su historial. Listo para la NC. */
  private async marcarReembolsado(
    tx: PrismaClient,
    tenantId: string,
    pagoId: string,
    detalle: string,
  ): Promise<void> {
    const { count } = await tx.pago.updateMany({
      where: { id: pagoId, estado: 'APROBADO' },
      data: {
        estado: 'REEMBOLSADO',
        // HU-023: los contadores pasan a contar los intentos de la nota de
        // crédito, que reintenta la conciliación de CFE.
        cfeIntentos: 0,
        cfeUltimoIntentoEn: null,
        cfeUltimoError: null,
      },
    });
    if (count === 0) return;
    await tx.pagoEstadoHistorial.create({
      data: {
        tenantId,
        pagoId,
        estadoAnterior: 'APROBADO',
        estadoNuevo: 'REEMBOLSADO',
        origen: 'CANCELACION',
        detalle,
      },
    });
  }

  private async cancelarEnTx(
    tx: PrismaClient,
    datos: {
      tenantId: string;
      actorKeycloakId: string;
      pedidoId: string;
      estadoAnterior: PedidoEstado;
      estadosPermitidos: PedidoEstado[];
      manuales: PagoParaDevolver[];
      dto: CancelarPedidoDto;
      monto: string;
      devoluciones: DevolucionDelPago[];
      pagos: string[];
    },
  ) {
    const { tenantId, pedidoId } = datos;
    // El updateMany condicionado es el que manda: si cocina lo pasó a listo
    // (o lo canceló otro mozo) entre medio, no cambia nada y es 409.
    const actual = await tx.pedido.findUnique({
      where: { id: pedidoId },
      select: { estado: true },
    });
    const { count } = await tx.pedido.updateMany({
      where: { id: pedidoId, estado: { in: datos.estadosPermitidos } },
      data: { estado: 'CANCELADO' },
    });
    if (count === 0 || !actual) {
      throw new ConflictException(
        'El pedido cambió de estado mientras se cancelaba. Revisalo y probá de nuevo.',
      );
    }

    const usuario = UUID.test(datos.actorKeycloakId)
      ? await tx.usuario.findUnique({
          where: { keycloakId: datos.actorKeycloakId },
          select: { id: true },
        })
      : null;
    await tx.pedidoEstadoHistorial.create({
      data: {
        tenantId,
        pedidoId,
        usuarioId: usuario?.id ?? null,
        estadoAnterior: actual.estado,
        estadoNuevo: 'CANCELADO',
      },
    });

    for (const pago of datos.manuales) {
      await /* NOSONAR */ this.marcarReembolsado(
        tx,
        tenantId,
        pago.id,
        'DEVOLUCION_MANUAL',
      );
    }

    // HU-015 (BL-120): si cocina no lo había empezado, el stock vuelve.
    const stockRepuesto =
      actual.estado === 'RECIBIDO'
        ? await this.pedidos.reponerStockEnTx(tx, tenantId, pedidoId)
        : null;

    // HU-042 (BL-463): si estaba en preparación, liberó un lugar.
    const promovidos = await completarCapacidad(tx, tenantId);

    // HU-035: con el motivo, lo devuelto y por qué medio. En la misma
    // transacción: sin auditoría no hay cancelación.
    await this.auditLog.registrarEnTx(tx, {
      action: AuditAction.PEDIDO_CANCELADO,
      tenantId,
      actorKeycloakId: datos.actorKeycloakId,
      entidadId: pedidoId,
      despues: {
        motivo: MOTIVOS_CANCELACION[datos.dto.motivo],
        monto: datos.monto,
        devolucion: datos.devoluciones
          .map(
            (d) =>
              `${NOMBRE_MEDIO[d.medio] ?? d.medio} (${d.automatica ? 'reembolso automático' : 'devolución manual'})`,
          )
          .join(', '),
        stockRepuesto: stockRepuesto !== null,
      },
      detalle: {
        motivo: datos.dto.motivo,
        ...(datos.dto.detalle ? { detalle: datos.dto.detalle } : {}),
        estadoAnterior: actual.estado,
        pagos: datos.pagos,
      },
    });

    return { estadoAnterior: actual.estado, stockRepuesto, promovidos };
  }
}

function sumar(pagos: PagoParaDevolver[]): string {
  return pagos
    .reduce((total, p) => total.plus(p.monto), new Prisma.Decimal(0))
    .toFixed(2);
}
