import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Pago, PrismaClient, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PedidosService } from '../../pedidos/pedidos.service';
import { PedidoParaKds } from '../../pedidos/pedido-kds.mapper';
import { CfeService } from '../../cfe/cfe.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../audit-log/audit-action.enum';
import { exigirPedidoPorPagar } from '../pedido-por-pagar';
import { calcularTotales, totalCobrado } from '../totales-pedido';
import { RegistrarCobroEfectivoDto } from './registrar-cobro-efectivo.dto';
import {
  RegistrarCobroPosDto,
  TarjetaPos,
} from '../pos/registrar-cobro-pos.dto';

/** HU-031 (BL-201): medio de pago de los cobros en efectivo. */
export const MEDIO_EFECTIVO = 'EFECTIVO';

/**
 * HU-007b (BL-80): medios de pago de los cobros con el POS del local. El
 * cobro lo hace el POS; BistroLink solo lo registra, con el número de
 * autorización (en pasarela_referencia). Nunca datos de la tarjeta.
 */
export const MEDIOS_POS: Readonly<Record<TarjetaPos, string>> = {
  CREDITO: 'POS_CREDITO',
  DEBITO: 'POS_DEBITO',
};

const NOMBRE_TARJETA: Readonly<Record<TarjetaPos, string>> = {
  CREDITO: 'Crédito',
  DEBITO: 'Débito',
};

function tarjetaDelMedio(medioPago: string): TarjetaPos | null {
  const entrada = Object.entries(MEDIOS_POS).find(([, m]) => m === medioPago);
  return entrada ? (entrada[0] as TarjetaPos) : null;
}

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
  /**
   * Total a cobrar, con 2 decimales: el consumo más la propina que eligió el
   * comensal (HU-022).
   */
  total: string;
  /**
   * HU-022 (BL-494): el consumo (suma de las líneas, lo que se factura) y la
   * propina elegida. El personal solo los ve: no los puede cambiar.
   */
  consumo: string;
  propina: string;
  /** Porcentaje elegido; null si fue un monto libre o no eligió propina. */
  propinaPorcentaje: number | null;
  lineas: { id: string; nombre: string; cantidad: number; subtotal: string }[];
  /** El comensal tiene un pago con tarjeta en curso: no se puede cobrar en efectivo. */
  pagoEnCurso: boolean;
  /**
   * HU-033 (BL-203): hasta cuándo sirve el link de pago vigente del pedido;
   * null si no tiene o ya venció. Nunca el link: solo se ve al generarlo.
   */
  linkPagoVenceEn: Date | null;
  /**
   * HU-031b (BL-442): el comensal avisó que paga en efectivo (cuándo y, si lo
   * dijo, con cuánto). Null si no avisó.
   */
  efectivoSolicitado: { en: Date; pagaCon: string | null } | null;
}

/**
 * HU-031b (BL-442): primero los que pidieron pagar en efectivo (el mozo
 * tiene que ir a cobrarlos), del más antiguo al más nuevo; después el resto,
 * por hora del pedido.
 */
export function ordenarPendientes(
  pedidos: PedidoPendienteDeCobro[],
): PedidoPendienteDeCobro[] {
  const momento = (p: PedidoPendienteDeCobro) =>
    (p.efectivoSolicitado?.en ?? p.createdAt).getTime();
  return [...pedidos].sort((a, b) => {
    const solicitoA = a.efectivoSolicitado ? 0 : 1;
    const solicitoB = b.efectivoSolicitado ? 0 : 1;
    return solicitoA - solicitoB || momento(a) - momento(b);
  });
}

export interface PendientesDeCobro {
  efectivoHabilitado: boolean;
  /** HU-007b (BL-80): el local registra cobros hechos con su POS. */
  posHabilitado: boolean;
  pedidos: PedidoPendienteDeCobro[];
}

export interface CobroEfectivoRegistrado {
  pagoId: string;
  pedidoId: string;
  /** Total cobrado (consumo + propina). */
  monto: string;
  /** HU-022 (BL-494): lo que se factura, y la propina cobrada aparte. */
  consumo: string;
  propina: string;
  montoRecibido: string;
  vuelto: string;
}

/** HU-007b (BL-80): cobro con el POS del local, ya registrado. */
export interface CobroPosRegistrado {
  pagoId: string;
  pedidoId: string;
  /** Total cobrado (consumo + propina, calculado en el backend). */
  monto: string;
  /** HU-022 (BL-494): lo que se factura, y la propina cobrada aparte. */
  consumo: string;
  propina: string;
  tarjeta: TarjetaPos;
  /** Número de autorización del voucher del POS. */
  autorizacion: string;
}

type ResultadoTx<R> =
  { repetido: R } | { cobro: R; pedidoConfirmado: PedidoParaKds };

/**
 * Lo que cambia entre los cobros que registra el personal (efectivo y POS).
 * El resto (pedido en PENDIENTE_PAGO, sin pago con tarjeta en curso, stock,
 * pedido a RECIBIDO, auditoría, KDS y CFE) es igual.
 */
interface CobroManual<R> {
  pedidoId: string;
  idempotencyKey: string;
  /**
   * HU-022 (BL-494): el total que el personal vio en pantalla. Si el comensal
   * cambió la propina mientras tanto, el total ya no coincide: 409 y no se
   * cobra. Opcional (los clientes anteriores no lo mandan).
   */
  totalEsperado?: string;
  /** Columna de restaurante que habilita el medio. */
  habilitadoPor: 'efectivoHabilitado' | 'posHabilitado';
  mensajeDeshabilitado: string;
  medioPago: string;
  pasarelaReferencia: string | null;
  /** Controles propios del medio sobre el total (ej. lo recibido alcanza). */
  validarMonto(monto: Prisma.Decimal): void;
  /** El pago con esta clave es de este mismo cobro (reintento). */
  esElMismo(pago: Pago): boolean;
  resumen(
    pago: Pick<
      Pago,
      | 'id'
      | 'pedidoId'
      | 'monto'
      | 'propina'
      | 'medioPago'
      | 'pasarelaReferencia'
    >,
  ): R;
  auditoria(cobro: R): {
    action: AuditAction;
    despues: Record<string, string>;
  };
}

function esClaveDuplicada(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function resumenDelCobro(
  pago: Pick<Pago, 'id' | 'pedidoId' | 'monto' | 'propina'>,
  recibido: Prisma.Decimal,
): CobroEfectivoRegistrado {
  const total = totalCobrado(pago);
  return {
    pagoId: pago.id,
    pedidoId: pago.pedidoId,
    monto: total.toFixed(2),
    consumo: pago.monto.toFixed(2),
    propina: pago.propina.toFixed(2),
    montoRecibido: recibido.toFixed(2),
    vuelto: recibido.minus(total).toFixed(2),
  };
}

/**
 * HU-031 (BL-201): el mozo o el administrador registra que el comensal pagó
 * en efectivo (RF.08). HU-007b (BL-80): o con el POS del local (crédito o
 * débito), con el mismo flujo: solo cambian el medio, el flag que lo
 * habilita y lo que va a la auditoría.
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
 * Stock (HU-015, BL-120): antes de registrar el cobro se verifica que
 * alcance (409 si no); se descuenta en confirmarPagoEnTx, que comparten todos
 * los medios.
 *
 * Propina (HU-022, BL-494): se cobra la que el comensal eligió y quedó
 * guardada en el pedido. El pago guarda el consumo en `monto` (lo que se
 * factura) y la propina aparte; el personal no puede cambiarla.
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
        select: { efectivoHabilitado: true, posHabilitado: true },
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
          efectivoSolicitadoEn: true,
          efectivoPagaCon: true,
          propinaPorcentaje: true,
          propinaMonto: true,
          linkPagoVenceEn: true,
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
        posHabilitado: restaurante?.posHabilitado ?? false,
        pedidos: ordenarPendientes(
          pedidos.map((pedido) => {
            const totales = calcularTotales(pedido.lineas, pedido);
            return {
              id: pedido.id,
              canal: pedido.canal,
              createdAt: pedido.createdAt,
              mesa: pedido.mesa,
              total: totales.total.toFixed(2),
              consumo: totales.consumo.toFixed(2),
              propina: totales.propina.toFixed(2),
              propinaPorcentaje: pedido.propinaPorcentaje ?? null,
              lineas: pedido.lineas.map((linea) => ({
                id: linea.id,
                nombre: linea.nombreSnapshot,
                cantidad: linea.cantidad,
                subtotal: linea.subtotal.toFixed(2),
              })),
              pagoEnCurso: pedido.pagos.length > 0,
              linkPagoVenceEn:
                pedido.linkPagoVenceEn && pedido.linkPagoVenceEn > ahora
                  ? pedido.linkPagoVenceEn
                  : null,
              efectivoSolicitado: pedido.efectivoSolicitadoEn
                ? {
                    en: pedido.efectivoSolicitadoEn,
                    pagaCon: pedido.efectivoPagaCon?.toFixed(2) ?? null,
                  }
                : null,
            };
          }),
        ),
      };
    });
  }

  async registrar(
    tenantId: string,
    actorKeycloakId: string,
    dto: RegistrarCobroEfectivoDto,
  ): Promise<CobroEfectivoRegistrado> {
    const recibido = new Prisma.Decimal(dto.montoRecibido);
    return this.cobrar(tenantId, actorKeycloakId, {
      pedidoId: dto.pedidoId,
      idempotencyKey: dto.idempotencyKey,
      totalEsperado: dto.totalEsperado,
      habilitadoPor: 'efectivoHabilitado',
      mensajeDeshabilitado:
        'El cobro en efectivo no está habilitado en este establecimiento',
      medioPago: MEDIO_EFECTIVO,
      pasarelaReferencia: null,
      validarMonto: (monto) => {
        if (recibido.lessThan(monto)) {
          throw new BadRequestException(
            `El monto recibido ($ ${recibido.toFixed(2)}) es menor que el total del pedido ($ ${monto.toFixed(2)})`,
          );
        }
      },
      esElMismo: (pago) => pago.medioPago === MEDIO_EFECTIVO,
      resumen: (pago) => resumenDelCobro(pago, recibido),
      auditoria: (cobro) => ({
        action: AuditAction.PAGO_EFECTIVO_REGISTRADO,
        // Un alta: no hay valores antes. La pantalla de Auditoría muestra
        // los de después (total, consumo, propina, recibido y vuelto).
        despues: {
          monto: cobro.monto,
          consumo: cobro.consumo,
          propina: cobro.propina,
          montoRecibido: cobro.montoRecibido,
          vuelto: cobro.vuelto,
        },
      }),
    });
  }

  /**
   * HU-007b (BL-80): registra un cobro hecho con el POS del local (crédito
   * o débito). Igual que el efectivo: el total lo calcula el backend y el
   * pedido pasa a cocina. Solo se guarda el número de autorización del
   * voucher, nunca datos de la tarjeta.
   */
  async registrarPos(
    tenantId: string,
    actorKeycloakId: string,
    dto: RegistrarCobroPosDto,
  ): Promise<CobroPosRegistrado> {
    const medioPago = MEDIOS_POS[dto.tarjeta];
    return this.cobrar(tenantId, actorKeycloakId, {
      pedidoId: dto.pedidoId,
      idempotencyKey: dto.idempotencyKey,
      totalEsperado: dto.totalEsperado,
      habilitadoPor: 'posHabilitado',
      mensajeDeshabilitado:
        'El cobro con el POS del local no está habilitado en este establecimiento',
      medioPago,
      pasarelaReferencia: dto.autorizacion,
      validarMonto: () => undefined,
      // Un reintento puede no traer exactamente lo mismo (el mozo corrigió
      // un dígito): lo que importa es que sea un cobro con POS del pedido.
      esElMismo: (pago) => tarjetaDelMedio(pago.medioPago) !== null,
      resumen: (pago) => ({
        pagoId: pago.id,
        pedidoId: pago.pedidoId,
        monto: totalCobrado(pago).toFixed(2),
        consumo: pago.monto.toFixed(2),
        propina: pago.propina.toFixed(2),
        tarjeta: tarjetaDelMedio(pago.medioPago) ?? dto.tarjeta,
        autorizacion: pago.pasarelaReferencia ?? dto.autorizacion,
      }),
      auditoria: (cobro) => ({
        action: AuditAction.PAGO_POS_REGISTRADO,
        // «medio» y no «tarjeta»: la auditoría oculta todo campo que se
        // llame como un dato de tarjeta (HU-035), y esto no lo es.
        despues: {
          monto: cobro.monto,
          consumo: cobro.consumo,
          propina: cobro.propina,
          medio: NOMBRE_TARJETA[cobro.tarjeta],
          autorizacion: cobro.autorizacion,
        },
      }),
    });
  }

  /**
   * Cobro que registra el personal (efectivo o POS). En una transacción:
   * pago APROBADO, pedido a RECIBIDO y auditoría. Confirmada, el pedido va al
   * KDS y se pide el CFE en segundo plano.
   */
  private async cobrar<R extends { pagoId: string }>(
    tenantId: string,
    actorKeycloakId: string,
    cobro: CobroManual<R>,
  ): Promise<R> {
    let resultado: ResultadoTx<R>;
    try {
      resultado = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
        this.registrarEnTx(tx, tenantId, actorKeycloakId, cobro),
      );
    } catch (error) {
      // Dos requests a la vez con la misma clave (doble clic): el segundo
      // choca con la clave única y devuelve el cobro del primero.
      if (!esClaveDuplicada(error)) throw error;
      const existente = await this.tenantPrisma.runInTenantContext(
        tenantId,
        (tx) =>
          tx.pago.findUnique({
            where: { idempotencyKey: cobro.idempotencyKey },
          }),
      );
      if (!existente) throw error;
      return this.repetido(existente, cobro);
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

  private async registrarEnTx<R>(
    tx: PrismaClient,
    tenantId: string,
    actorKeycloakId: string,
    cobro: CobroManual<R>,
  ): Promise<ResultadoTx<R>> {
    // Idempotencia primero: un reintento llega cuando el pedido ya está en
    // RECIBIDO, y tiene que devolver el mismo cobro, no un 409.
    const existente = await tx.pago.findUnique({
      where: { idempotencyKey: cobro.idempotencyKey },
    });
    if (existente) {
      return { repetido: this.repetido(existente, cobro) };
    }

    const restaurante = await tx.restaurante.findUnique({
      where: { tenantId },
      select: { [cobro.habilitadoPor]: true },
    });
    if (!restaurante?.[cobro.habilitadoPor]) {
      throw new ConflictException(cobro.mensajeDeshabilitado);
    }

    const pedido = exigirPedidoPorPagar(
      await tx.pedido.findUnique({
        where: { id: cobro.pedidoId },
        select: {
          id: true,
          estado: true,
          propinaPorcentaje: true,
          propinaMonto: true,
          lineas: { select: { subtotal: true } },
          pagos: { where: { estado: 'PENDIENTE' }, select: { id: true } },
        },
      }),
    );
    if (pedido.pagos.length > 0) {
      throw new ConflictException(
        'El comensal tiene un pago con tarjeta en curso para este pedido. Esperá a que termine: si no se confirma, vence solo en unos minutos.',
      );
    }

    // HU-022 (BL-494): consumo (lo que se factura) y propina elegida por el
    // comensal; se cobra el total. El personal no cambia la propina.
    const totales = calcularTotales(pedido.lineas, pedido);
    if (totales.consumo.lessThanOrEqualTo(0)) {
      throw new BadRequestException('El pedido no tiene monto a cobrar');
    }
    if (
      cobro.totalEsperado !== undefined &&
      !totales.total.equals(cobro.totalEsperado)
    ) {
      throw new ConflictException(
        `El total del pedido cambió: ahora es $ ${totales.total.toFixed(2)}. Actualizá la lista antes de cobrar.`,
      );
    }
    cobro.validarMonto(totales.total);
    // HU-015 (BL-120): el cobro ya ocurrió en mano (efectivo o POS): si el
    // stock ya no alcanza, 409 antes de registrarlo (D3, ADR 0009).
    await this.pedidos.verificarStockEnTx(tx, pedido.id);

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
        idempotencyKey: cobro.idempotencyKey,
        monto: totales.consumo,
        propina: totales.propina,
        medioPago: cobro.medioPago,
        estado: 'APROBADO',
        ...(cobro.pasarelaReferencia
          ? { pasarelaReferencia: cobro.pasarelaReferencia }
          : {}),
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

    const resumen = cobro.resumen(pago);
    const { action, despues } = cobro.auditoria(resumen);
    await this.auditLog.registrarEnTx(tx, {
      action,
      tenantId,
      actorKeycloakId,
      entidadId: pago.id,
      despues,
      detalle: { pedidoId: pedido.id },
    });

    return { cobro: resumen, pedidoConfirmado };
  }

  /** Mismo cobro de un reintento con la misma clave. */
  private repetido<R>(existente: Pago, cobro: CobroManual<R>): R {
    if (!cobro.esElMismo(existente) || existente.pedidoId !== cobro.pedidoId) {
      throw new ConflictException(
        'La clave de idempotencia ya se usó en otro cobro',
      );
    }
    return cobro.resumen(existente);
  }
}
