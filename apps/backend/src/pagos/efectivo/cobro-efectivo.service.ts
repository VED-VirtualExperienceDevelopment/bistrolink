import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pago, PrismaClient, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PedidosService } from '../../pedidos/pedidos.service';
import { PedidoParaKds } from '../../pedidos/pedido-kds.mapper';
import { CfeService } from '../../cfe/cfe.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../audit-log/audit-action.enum';
import { RegistrarCobroEfectivoDto } from './registrar-cobro-efectivo.dto';

/** HU-031 (BL-201): medio de pago de los cobros en efectivo. */
export const MEDIO_EFECTIVO = 'EFECTIVO';

/**
 * Los pedidos para retirar (mesa virtual) no se cancelan solos: un carrito
 * abandonado queda en PENDIENTE_PAGO. Para que la lista del mozo no se llene
 * de pedidos viejos, solo se muestran los de las últimas horas. Los de mesa
 * se cancelan al cerrar la mesa (HU-017), así que se muestran todos.
 */
export const HORAS_PENDIENTES_RETIRO = 12;

const MAXIMO_PENDIENTES = 100;
// usuario.keycloak_id es UUID: un actor que no lo es (un script, por ejemplo
// «script:…») no tiene fila y ni se busca (Postgres rechazaría el valor).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA_MS = 60 * 60 * 1000;

export interface PedidoPendienteDeCobro {
  id: string;
  canal: string;
  createdAt: Date;
  mesa: { id: string; numero: number; esVirtual: boolean };
  /** Total del pedido (suma de las líneas), con 2 decimales. */
  total: string;
  lineas: { id: string; nombre: string; cantidad: number; subtotal: string }[];
  /** El comensal tiene un pago con tarjeta en curso: no se puede cobrar en efectivo. */
  pagoEnCurso: boolean;
}

export interface PendientesDeCobro {
  efectivoHabilitado: boolean;
  pedidos: PedidoPendienteDeCobro[];
}

export interface CobroEfectivoRegistrado {
  pagoId: string;
  pedidoId: string;
  /** Total cobrado. */
  monto: string;
  montoRecibido: string;
  vuelto: string;
}

type ResultadoTx =
  | { repetido: CobroEfectivoRegistrado }
  | { cobro: CobroEfectivoRegistrado; pedidoConfirmado: PedidoParaKds };

function esClaveDuplicada(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function sumarLineas(lineas: { subtotal: Prisma.Decimal }[]): Prisma.Decimal {
  return lineas.reduce(
    (acumulado, linea) => acumulado.plus(linea.subtotal),
    new Prisma.Decimal(0),
  );
}

function resumenDelCobro(
  pago: Pick<Pago, 'id' | 'pedidoId' | 'monto'>,
  recibido: Prisma.Decimal,
): CobroEfectivoRegistrado {
  return {
    pagoId: pago.id,
    pedidoId: pago.pedidoId,
    monto: pago.monto.toFixed(2),
    montoRecibido: recibido.toFixed(2),
    vuelto: recibido.minus(pago.monto).toFixed(2),
  };
}

/**
 * HU-031 (BL-201): el mozo o el administrador registra que el comensal pagó
 * en efectivo (RF.08).
 *
 * En una sola transacción: Pago EFECTIVO/APROBADO, pedido de PENDIENTE_PAGO
 * a RECIBIDO (RD.03) con quién lo cobró en el historial, y el registro de
 * auditoría (HU-035). Recién confirmada, el pedido va al KDS y se pide el
 * CFE en segundo plano, igual que con la tarjeta.
 *
 * A diferencia del pago con tarjeta, no hay una pasarela en el medio: el cobro
 * ya ocurrió cuando se registra. Por eso la mesa no pasa por
 * EN_PROCESO_DE_PAGO: queda OCUPADA (el comensal pagó antes de comer).
 *
 * Stock: la carta todavía no maneja stock (solo «disponible», HU-005). Cuando
 * exista, se descuenta en confirmarPagoEnTx, que comparten todos los medios.
 */
@Injectable()
export class CobroEfectivoService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly pedidos: PedidosService,
    private readonly cfe: CfeService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Pedidos que esperan el pago, de las mesas y para retirar. */
  async pendientes(
    tenantId: string,
    ahora: Date = new Date(),
  ): Promise<PendientesDeCobro> {
    const desdeRetiro = new Date(
      ahora.getTime() - HORAS_PENDIENTES_RETIRO * HORA_MS,
    );
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const restaurante = await tx.restaurante.findUnique({
        where: { tenantId },
        select: { efectivoHabilitado: true },
      });
      const pedidos = await tx.pedido.findMany({
        where: {
          estado: 'PENDIENTE_PAGO',
          OR: [
            { mesa: { esVirtual: false } },
            { mesa: { esVirtual: true }, createdAt: { gte: desdeRetiro } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: MAXIMO_PENDIENTES,
        select: {
          id: true,
          canal: true,
          createdAt: true,
          mesa: { select: { id: true, numero: true, esVirtual: true } },
          lineas: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              nombreSnapshot: true,
              cantidad: true,
              subtotal: true,
            },
          },
          pagos: { where: { estado: 'PENDIENTE' }, select: { id: true } },
        },
      });
      return {
        efectivoHabilitado: restaurante?.efectivoHabilitado ?? false,
        pedidos: pedidos.map((pedido) => ({
          id: pedido.id,
          canal: pedido.canal,
          createdAt: pedido.createdAt,
          mesa: pedido.mesa,
          total: sumarLineas(pedido.lineas).toFixed(2),
          lineas: pedido.lineas.map((linea) => ({
            id: linea.id,
            nombre: linea.nombreSnapshot,
            cantidad: linea.cantidad,
            subtotal: linea.subtotal.toFixed(2),
          })),
          pagoEnCurso: pedido.pagos.length > 0,
        })),
      };
    });
  }

  async registrar(
    tenantId: string,
    actorKeycloakId: string,
    dto: RegistrarCobroEfectivoDto,
  ): Promise<CobroEfectivoRegistrado> {
    const recibido = new Prisma.Decimal(dto.montoRecibido);

    let resultado: ResultadoTx;
    try {
      resultado = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
        this.registrarEnTx(tx, tenantId, actorKeycloakId, dto, recibido),
      );
    } catch (error) {
      // Dos requests a la vez con la misma clave (doble clic): el segundo
      // choca con la clave única y devuelve el cobro del primero.
      if (!esClaveDuplicada(error)) throw error;
      const existente = await this.tenantPrisma.runInTenantContext(
        tenantId,
        (tx) =>
          tx.pago.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          }),
      );
      if (!existente) throw error;
      return this.repetido(existente, dto, recibido);
    }

    if ('repetido' in resultado) {
      return resultado.repetido;
    }

    // Recién con la transacción confirmada: el pedido entra al KDS y se pide
    // el CFE (e-Ticket) sin esperar a Surtec. Si Surtec falla, el cobro no se
    // pierde: lo retoma la conciliación de CFE (HU-023).
    this.pedidos.notificarPedidoConfirmado(
      tenantId,
      resultado.pedidoConfirmado,
    );
    this.cfe.emitirEnSegundoPlano(tenantId, resultado.cobro.pagoId);
    return resultado.cobro;
  }

  private async registrarEnTx(
    tx: PrismaClient,
    tenantId: string,
    actorKeycloakId: string,
    dto: RegistrarCobroEfectivoDto,
    recibido: Prisma.Decimal,
  ): Promise<ResultadoTx> {
    // Idempotencia primero: un reintento llega cuando el pedido ya está en
    // RECIBIDO, y tiene que devolver el mismo cobro, no un 409.
    const existente = await tx.pago.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existente) {
      return { repetido: this.repetido(existente, dto, recibido) };
    }

    const restaurante = await tx.restaurante.findUnique({
      where: { tenantId },
      select: { efectivoHabilitado: true },
    });
    if (!restaurante?.efectivoHabilitado) {
      throw new ConflictException(
        'El cobro en efectivo no está habilitado en este establecimiento',
      );
    }

    const pedido = await tx.pedido.findUnique({
      where: { id: dto.pedidoId },
      select: {
        id: true,
        estado: true,
        lineas: { select: { subtotal: true } },
        pagos: { where: { estado: 'PENDIENTE' }, select: { id: true } },
      },
    });
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }
    if (pedido.estado === 'CANCELADO') {
      throw new ConflictException('El pedido está cancelado');
    }
    if (pedido.estado !== 'PENDIENTE_PAGO') {
      throw new ConflictException('Este pedido ya fue pagado');
    }
    if (pedido.pagos.length > 0) {
      throw new ConflictException(
        'El comensal tiene un pago con tarjeta en curso para este pedido. Esperá a que termine: si no se confirma, vence solo en unos minutos.',
      );
    }

    const monto = sumarLineas(pedido.lineas);
    if (monto.lessThanOrEqualTo(0)) {
      throw new BadRequestException('El pedido no tiene monto a cobrar');
    }
    if (recibido.lessThan(monto)) {
      throw new BadRequestException(
        `El monto recibido ($ ${recibido.toFixed(2)}) es menor que el total del pedido ($ ${monto.toFixed(2)})`,
      );
    }

    const usuario = UUID.test(actorKeycloakId)
      ? await tx.usuario.findUnique({
          where: { keycloakId: actorKeycloakId },
          select: { id: true },
        })
      : null;
    const pago = await tx.pago.create({
      data: {
        tenantId,
        pedidoId: pedido.id,
        idempotencyKey: dto.idempotencyKey,
        monto,
        medioPago: MEDIO_EFECTIVO,
        estado: 'APROBADO',
      },
    });

    // Si otro cobro (otra pestaña, otra clave, o la tarjeta) confirmó el
    // pedido entre medio, este no puede quedar: se revierte todo, también el
    // pago recién creado. updateMany bloquea la fila del pedido, así que de
    // dos cobros simultáneos solo uno lo pasa a RECIBIDO.
    const pedidoConfirmado = await this.pedidos.confirmarPagoEnTx(
      tx,
      tenantId,
      pedido.id,
      usuario?.id ?? null,
    );
    if (!pedidoConfirmado) {
      throw new ConflictException('Este pedido ya fue pagado');
    }

    const cobro = resumenDelCobro(pago, recibido);
    await this.auditLog.registrarEnTx(tx, {
      action: AuditAction.PAGO_EFECTIVO_REGISTRADO,
      tenantId,
      actorKeycloakId,
      entidadId: pago.id,
      // Un alta: no hay valores antes. La pantalla de Auditoría muestra los
      // de después (total, recibido y vuelto).
      despues: {
        monto: cobro.monto,
        montoRecibido: cobro.montoRecibido,
        vuelto: cobro.vuelto,
      },
      detalle: { pedidoId: pedido.id },
    });

    return { cobro, pedidoConfirmado };
  }

  /** Mismo cobro de un reintento con la misma clave. */
  private repetido(
    existente: Pago,
    dto: RegistrarCobroEfectivoDto,
    recibido: Prisma.Decimal,
  ): CobroEfectivoRegistrado {
    if (
      existente.medioPago !== MEDIO_EFECTIVO ||
      existente.pedidoId !== dto.pedidoId
    ) {
      throw new ConflictException(
        'La clave de idempotencia ya se usó en otro cobro',
      );
    }
    return resumenDelCobro(existente, recibido);
  }
}
