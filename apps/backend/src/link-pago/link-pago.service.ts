import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { configuracionConciliacion } from '../pagos/conciliacion/configuracion-conciliacion';
import { calcularTotales } from '../pagos/totales-pedido';
import { leerLinkPago, nuevoLinkPago } from './link-pago-token';
import {
  CODIGO_LINK_ACTIVO,
  codigoDelLink,
  estadoDelLink,
  hayLinkVigente,
  MENSAJE_LINK_ACTIVO,
  MENSAJE_LINK_INVALIDO,
  MENSAJE_NO_ESPERA_PAGO,
  MENSAJE_PAGO_EN_CURSO,
  mensajeDelLink,
  sinBarraFinal,
  venceEn,
} from './link-pago';

export interface LinkPagoGenerado {
  url: string;
  venceEn: string;
}

/** Lo que ve el comensal al abrir el link (GET /link-pago). */
export interface ResumenLinkPago {
  pedidoId: string;
  estadoPedido: string;
  restaurante: { nombre: string };
  /** Null en un pedido para retirar (mesa virtual). */
  mesaNumero: number | null;
  lineas: {
    itemCartaId: string;
    nombre: string;
    cantidad: number;
    precio: string;
  }[];
  consumo: string;
  venceEn: string | null;
}

/** El link resuelto: de qué tenant, restaurante y pedido es. */
export interface LinkResuelto {
  tenantId: string;
  restauranteId: string;
  pedidoId: string;
}

/**
 * HU-033 (BL-203): link de pago que genera el mozo para que el comensal
 * pague un pedido pendiente desde su celular.
 *
 * - Uno solo por pedido: se guarda el hash del nonce del link vigente, así
 *   que generar otro invalida el anterior.
 * - Vence con el mismo plazo que un pago pendiente (HU-032,
 *   PAGOS_VENCER_DESPUES_MIN).
 * - El pago sigue el flujo de siempre (POST /pedidos/:id/pagos y el webhook
 *   de HU-007); PedidoAccesoGuard acepta el link como credencial.
 */
@Injectable()
export class LinkPagoService {
  private readonly logger = new Logger(LinkPagoService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private urlBaseFrontend(): string {
    const url = process.env.FRONTEND_URL;
    if (!url) {
      this.logger.error('Falta FRONTEND_URL: no se puede generar el link');
      throw new InternalServerErrorException(
        'No se pudo generar el link de pago',
      );
    }
    return sinBarraFinal(url);
  }

  /**
   * El mozo o el administrador genera el link de un pedido que espera el
   * pago. 404 si no existe en su tenant; 409 si ya no espera el pago o si
   * hay un pago en curso (el comensal pagando por otro lado).
   *
   * Varios colaboradores: si el pedido ya tiene un link vigente, solo se
   * reemplaza con `reemplazar` (el colaborador vio el aviso y confirmó). Si
   * no, 409 con `codigo` LINK_PAGO_ACTIVO: la pantalla de otro mozo puede
   * estar desactualizada y no saber que hay un link. El guardado compara el
   * link que se leyó, así que si dos generan a la vez, el segundo recibe el
   * mismo 409 en vez de mostrar un QR que ya no sirve.
   */
  async generar(params: {
    tenantId: string;
    keycloakId: string;
    pedidoId: string;
    reemplazar?: boolean;
    ahora?: Date;
  }): Promise<LinkPagoGenerado> {
    const { tenantId, keycloakId, pedidoId } = params;
    const ahora = params.ahora ?? new Date();
    const base = this.urlBaseFrontend();
    const vence = venceEn(
      ahora,
      configuracionConciliacion(process.env).vencerDespuesMs,
    );

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id: pedidoId },
        select: {
          estado: true,
          linkPagoHash: true,
          linkPagoVenceEn: true,
          pagos: { where: { estado: 'PENDIENTE' }, select: { id: true } },
        },
      });
      if (!pedido) throw new NotFoundException('Pedido no encontrado');
      if (pedido.estado !== 'PENDIENTE_PAGO') {
        throw new ConflictException(MENSAJE_NO_ESPERA_PAGO);
      }
      if (pedido.pagos.length > 0) {
        throw new ConflictException(MENSAJE_PAGO_EN_CURSO);
      }

      if (hayLinkVigente(pedido, ahora) && !params.reemplazar) {
        throw this.hayOtroLink();
      }

      const { token, hash } = nuevoLinkPago(tenantId, pedidoId);
      // Solo si el pedido sigue como se leyó (mismo link, esperando el pago).
      const { count } = await tx.pedido.updateMany({
        where: {
          id: pedidoId,
          estado: 'PENDIENTE_PAGO',
          linkPagoHash: pedido.linkPagoHash,
        },
        data: { linkPagoHash: hash, linkPagoVenceEn: vence },
      });
      if (count === 0) throw this.hayOtroLink();
      // Sin el token ni la URL: con ellos se podría pagar o ver el pedido.
      await this.auditLog.registrarEnTx(tx, {
        action: AuditAction.PEDIDO_LINK_PAGO_GENERADO,
        tenantId,
        actorKeycloakId: keycloakId,
        entidad: 'pedido',
        entidadId: pedidoId,
        detalle: {
          venceEn: vence.toISOString(),
          reemplazaOtro: pedido.linkPagoHash !== null,
        },
      });

      return { url: `${base}/pagar/${token}`, venceEn: vence.toISOString() };
    });
  }

  private hayOtroLink(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      codigo: CODIGO_LINK_ACTIVO,
      message: MENSAJE_LINK_ACTIVO,
    });
  }

  /**
   * El comensal abre el link: a qué tenant, restaurante y pedido
   * corresponde. Sirve mientras sea el link vigente del pedido y se pueda
   * pagar o ya esté pagado.
   * - 404 si el token no es un link válido o el pedido no existe.
   * - 410 con `codigo` si venció, lo reemplazó otro, el pedido se canceló o
   *   pasó el plazo de consulta (caducado).
   */
  async resolver(
    token: string,
    ahora: Date = new Date(),
  ): Promise<LinkResuelto> {
    const datos = leerLinkPago(token);
    if (!datos) throw new NotFoundException(MENSAJE_LINK_INVALIDO);

    const pedido = await this.tenantPrisma.runInTenantContext(
      datos.tenantId,
      (tx) =>
        tx.pedido.findUnique({
          where: { id: datos.pedidoId },
          select: {
            restauranteId: true,
            estado: true,
            linkPagoHash: true,
            linkPagoVenceEn: true,
          },
        }),
    );
    if (!pedido) throw new NotFoundException(MENSAJE_LINK_INVALIDO);

    const estado = estadoDelLink(pedido, datos.nonce, ahora);
    const codigo = codigoDelLink(estado);
    if (codigo) {
      throw new GoneException({
        statusCode: 410,
        codigo,
        message: mensajeDelLink(estado),
      });
    }
    return {
      tenantId: datos.tenantId,
      restauranteId: pedido.restauranteId,
      pedidoId: datos.pedidoId,
    };
  }

  /**
   * GET /link-pago: el pedido del link, para mostrarlo antes de pagar. El
   * tenant del JWT del comensal tiene que ser el del link (403 si no).
   */
  async resumen(
    tenantIdDelJwt: string,
    token: string,
    ahora: Date = new Date(),
  ): Promise<ResumenLinkPago> {
    const link = await this.resolver(token, ahora);
    if (link.tenantId !== tenantIdDelJwt) {
      throw new ForbiddenException('Este link es de otro local');
    }
    return this.tenantPrisma.runInTenantContext(link.tenantId, async (tx) => {
      const pedido = await tx.pedido.findUniqueOrThrow({
        where: { id: link.pedidoId },
        select: {
          id: true,
          estado: true,
          linkPagoVenceEn: true,
          restaurante: { select: { nombre: true } },
          mesa: { select: { numero: true, esVirtual: true } },
          lineas: {
            orderBy: { createdAt: 'asc' },
            select: {
              itemCartaId: true,
              nombreSnapshot: true,
              cantidad: true,
              precioUnitarioSnapshot: true,
              subtotal: true,
            },
          },
        },
      });
      // Solo el consumo: la propina la elige el comensal al pagar.
      const { consumo } = calcularTotales(pedido.lineas);
      return {
        pedidoId: pedido.id,
        estadoPedido: pedido.estado,
        restaurante: { nombre: pedido.restaurante.nombre },
        mesaNumero: pedido.mesa.esVirtual ? null : pedido.mesa.numero,
        lineas: pedido.lineas.map((l) => ({
          itemCartaId: l.itemCartaId,
          nombre: l.nombreSnapshot,
          cantidad: l.cantidad,
          precio: l.precioUnitarioSnapshot.toFixed(2),
        })),
        consumo: consumo.toFixed(2),
        venceEn: pedido.linkPagoVenceEn?.toISOString() ?? null,
      };
    });
  }
}
