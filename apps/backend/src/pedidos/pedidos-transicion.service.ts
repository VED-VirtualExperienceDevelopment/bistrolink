import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PedidoEstado, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { aPedidoKds } from './pedido-kds.mapper';
import { normalizarCodigoRetiro } from './retiro';
import type { LlamadoPagoEfectivo } from './kds.gateway';
import {
  bloquearColaDelTenant,
  completarCapacidad,
  contarEnPreparacion,
  estadoDeLaCola,
  limiteDeLaCola,
  type EstadoCola,
  type PedidoPromovido,
} from './cola-kds';
import {
  SELECT_UMBRALES_ESPERA,
  umbralesDelRestaurante,
  type UmbralesEspera,
} from './umbrales-espera';

/**
 * BL-448: un aviso de «Mesa N quiere pagar en efectivo» pendiente, con la
 * misma forma que el evento en vivo `llamado:nuevo` (KdsGateway.emitirLlamado).
 */
export interface SolicitudEfectivoPendiente extends LlamadoPagoEfectivo {
  mesaId: string;
  mesaNumero: number;
  /** Cuándo lo pidió el comensal (ms), como el `ts` del evento en vivo. */
  ts: number;
  motivo: 'PAGO_EFECTIVO';
}

// Subconjunto de transiciones que el KDS puede disparar (RF.03/RNF.05).
// El resto de la máquina de estados (RECIBIDO viene de HU-003, ENTREGADO lo
// confirma el mozo desde su propio panel, CANCELADO es otro módulo) no es
// responsabilidad de este servicio.
const TRANSICIONES_KDS: Partial<Record<PedidoEstado, PedidoEstado[]>> = {
  RECIBIDO: [PedidoEstado.EN_PREPARACION],
  EN_PREPARACION: [PedidoEstado.LISTO_PARA_ENTREGAR],
  LISTO_PARA_ENTREGAR: [PedidoEstado.ENTREGADO], // HU-018/BL-64
};

/** HU-040 (BL-210): el retiro no se entrega con el botón común. */
export const MENSAJE_ENTREGA_CON_CODIGO =
  'Los pedidos para retirar se entregan verificando el código de retiro';

interface LineaNotificacion {
  id: string;
  nombreSnapshot: string;
  cantidad: number;
}

export interface PedidoActualizado {
  id: string;
  estado: PedidoEstado;
  actualizadoEn: string;
  mesaNumero: number;
  // BL-66: select explícito, nunca `include` a lo bruto — LineaPedido
  // tiene precioUnitarioSnapshot/subtotal (dato de pago) que esta
  // notificación no debe exponer.
  lineas: LineaNotificacion[];
}

/**
 * HU-042 (BL-463): el pedido que cambió y los que la cola pasó a
 * EN_PREPARACION en la misma transacción (al liberarse un lugar).
 */
export interface ResultadoTransicion {
  actualizado: PedidoActualizado;
  promovidos: PedidoPromovido[];
}

@Injectable()
export class PedidosTransicionService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Transición de estado pedida desde el KDS. Reusa exactamente el mismo
   * mecanismo de aislamiento que PedidosService.crear():
   * TenantPrismaService.runInTenantContext, no un set_config manual aparte.
   */
  async transicionar(params: {
    tenantId: string;
    keycloakId: string; // payload.sub del JWT — todavía no es Usuario.id
    pedidoId: string;
    nuevoEstado: PedidoEstado;
  }): Promise<ResultadoTransicion> {
    const { tenantId, keycloakId, pedidoId, nuevoEstado } = params;

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const pedido = await tx.pedido.findUnique({ where: { id: pedidoId } });

      // No distinguir "no existe" de "existe en otro tenant" (RLS ya lo
      // oculta): ambos casos devuelven el mismo 404 hacia el cliente WS.
      if (!pedido) {
        throw new NotFoundException('Pedido no encontrado');
      }

      const permitidas = TRANSICIONES_KDS[pedido.estado] ?? [];
      if (!permitidas.includes(nuevoEstado)) {
        throw new BadRequestException(
          `Transición inválida: ${pedido.estado} → ${nuevoEstado}`,
        );
      }
      // HU-040 (BL-210): un pedido para retirar se entrega verificando el
      // código que muestra el comensal (POST /pedidos/:id/entregar-retiro).
      if (nuevoEstado === PedidoEstado.ENTREGADO && pedido.codigoRetiro) {
        throw new BadRequestException(MENSAJE_ENTREGA_CON_CODIGO);
      }

      // El JWT trae el keycloakId (payload.sub), pero el historial
      // referencia Usuario.id (PK interna) — hay que resolverlo. A
      // diferencia de Comensal/Cocina (que nunca tienen fila en Usuario,
      // por diseño), un token MOZO/ADMIN SIEMPRE debería resolver a una
      // fila real: si no la encuentra, es una desincronización real entre
      // Keycloak y Postgres, no un caso válido a tolerar con un
      // usuarioId null. Se corta acá en vez de dejar un historial huérfano.
      const usuario = await tx.usuario.findUnique({
        where: { keycloakId },
      });

      if (!usuario) {
        throw new NotFoundException(
          'El usuario autenticado (MOZO/ADMIN) no tiene fila correspondiente en Usuario — revisar sincronización con Keycloak',
        );
      }

      // HU-042 (BL-463, ADR 0010): con la cola activa, pasar un pedido a
      // preparación a mano respeta el límite. El lock evita que un pago
      // aprobado en el mismo momento ocupe el mismo lugar.
      if (nuevoEstado === PedidoEstado.EN_PREPARACION) {
        const limite = await limiteDeLaCola(tx, tenantId);
        if (limite !== null) {
          await bloquearColaDelTenant(tx, tenantId);
          if ((await contarEnPreparacion(tx, tenantId)) >= limite) {
            throw new BadRequestException(
              `La cocina está al límite de ${limite} pedidos en preparación. El pedido sigue en espera.`,
            );
          }
        }
      }

      const actualizado = await tx.pedido.update({
        where: { id: pedidoId },
        data: { estado: nuevoEstado },
        select: {
          id: true,
          estado: true,
          updatedAt: true,
          mesa: { select: { numero: true } },
          lineas: {
            select: { id: true, nombreSnapshot: true, cantidad: true },
          },
        },
      });

      await tx.pedidoEstadoHistorial.create({
        data: {
          tenantId,
          pedidoId,
          usuarioId: usuario.id,
          estadoAnterior: pedido.estado,
          estadoNuevo: nuevoEstado,
        },
      });

      // HU-042 (BL-463): el pedido salió de preparación y liberó un lugar:
      // pasa a preparación el más antiguo de la cola, en esta transacción.
      const promovidos =
        nuevoEstado === PedidoEstado.LISTO_PARA_ENTREGAR
          ? await completarCapacidad(tx, tenantId)
          : [];

      return {
        actualizado: {
          id: actualizado.id,
          estado: actualizado.estado,
          actualizadoEn: actualizado.updatedAt.toISOString(),
          mesaNumero: actualizado.mesa.numero,
          lineas: actualizado.lineas,
        },
        promovidos,
      };
    });
  }

  /**
   * HU-040 (BL-210): el comensal pasa a retirar y el mozo o el
   * administrador escribe el código que muestra (R-042). Solo si el pedido
   * es para retirar, está listo y el código coincide, pasa a ENTREGADO, con
   * el historial. Así no se entrega el pedido equivocado.
   */
  async entregarRetiro(params: {
    tenantId: string;
    keycloakId: string;
    pedidoId: string;
    codigo: string;
  }): Promise<PedidoActualizado> {
    const { tenantId, keycloakId, pedidoId } = params;
    const codigo = normalizarCodigoRetiro(params.codigo);
    if (!codigo) {
      throw new BadRequestException('El código de retiro tiene la forma R-042');
    }
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id: pedidoId },
        select: { estado: true, codigoRetiro: true },
      });
      if (!pedido) {
        throw new NotFoundException('Pedido no encontrado');
      }
      if (!pedido.codigoRetiro) {
        throw new ConflictException('Este pedido no es para retirar');
      }
      if (pedido.estado !== PedidoEstado.LISTO_PARA_ENTREGAR) {
        throw new ConflictException(
          pedido.estado === PedidoEstado.ENTREGADO
            ? 'Este pedido ya se entregó'
            : 'El pedido todavía no está listo para retirar',
        );
      }
      if (pedido.codigoRetiro !== codigo) {
        throw new ConflictException(
          `El código no coincide: este pedido es el ${pedido.codigoRetiro}. Revisá el pedido antes de entregarlo.`,
        );
      }
      const usuario = await tx.usuario.findUnique({ where: { keycloakId } });
      if (!usuario) {
        throw new NotFoundException(
          'El usuario autenticado (MOZO/ADMIN) no tiene fila correspondiente en Usuario — revisar sincronización con Keycloak',
        );
      }
      // Solo si sigue listo: dos personas entregando a la vez no duplican.
      const { count } = await tx.pedido.updateMany({
        where: { id: pedidoId, estado: PedidoEstado.LISTO_PARA_ENTREGAR },
        data: { estado: PedidoEstado.ENTREGADO },
      });
      if (count === 0) {
        throw new ConflictException('Este pedido ya se entregó');
      }
      await tx.pedidoEstadoHistorial.create({
        data: {
          tenantId,
          pedidoId,
          usuarioId: usuario.id,
          estadoAnterior: PedidoEstado.LISTO_PARA_ENTREGAR,
          estadoNuevo: PedidoEstado.ENTREGADO,
        },
      });
      const entregado = await tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: {
          id: true,
          estado: true,
          updatedAt: true,
          mesa: { select: { numero: true } },
          lineas: {
            select: { id: true, nombreSnapshot: true, cantidad: true },
          },
        },
      });
      return {
        id: entregado.id,
        estado: entregado.estado,
        actualizadoEn: entregado.updatedAt.toISOString(),
        mesaNumero: entregado.mesa.numero,
        lineas: entregado.lineas,
      };
    });
  }

  /**
   * HU-042 (BL-464): estado de la cola del tenant, para `cola:actualizada`
   * y para el lugar de cada comensal. RLS limita la consulta al tenant.
   */
  async estadoCola(tenantId: string): Promise<EstadoCola> {
    return this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      estadoDeLaCola(tx, tenantId),
    );
  }

  /**
   * HU-038 (BL-506): umbrales de espera del tenant, para que el KDS pinte
   * las comandas. Sin restaurante (alta incompleta), los de por defecto. RLS
   * limita la consulta al tenant.
   */
  async umbralesEspera(tenantId: string): Promise<UmbralesEspera> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const restaurante = await tx.restaurante.findUnique({
        where: { tenantId },
        select: SELECT_UMBRALES_ESPERA,
      });
      return umbralesDelRestaurante(restaurante);
    });
  }

  /** Para HU-006: estado actual de un pedido puntual, al suscribirse (por
   * primera vez o tras reconectar). Mismo aislamiento por tenant que el
   * resto del servicio — si pedidoId pertenece a otro tenant, esto
   * devuelve null, nunca los datos ajenos. */
  async obtenerResumen(
    tenantId: string,
    pedidoId: string,
  ): Promise<PedidoActualizado | null> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id: pedidoId },
        select: {
          id: true,
          estado: true,
          updatedAt: true,
          mesa: { select: { numero: true } },
          lineas: {
            select: { id: true, nombreSnapshot: true, cantidad: true },
          },
        },
      });
      if (!pedido) {
        return null;
      }
      return {
        id: pedido.id,
        estado: pedido.estado,
        actualizadoEn: pedido.updatedAt.toISOString(),
        mesaNumero: pedido.mesa.numero,
        lineas: pedido.lineas,
      };
    });
  }

  /** Snapshot para `pedidos:sync` — al conectar y tras una reconexión.
   * Shape alineado 1:1 con el tipo `Pedido` del frontend (mesaNumero,
   * createdAt, lineas[].nombreSnapshot) para que KdsBoard/OrderTicket
   * puedan renderizar esto igual que la respuesta REST, sin un adaptador
   * intermedio entre ambos canales. */
  async listarPendientes(tenantId: string) {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const pedidos = await tx.pedido.findMany({
        where: {
          estado: {
            // HU-018/BL-65: si no se incluye LISTO_PARA_ENTREGAR acá, un
            // mozo que se reconecta pierde para siempre la notificación
            // de un pedido que quedó esperando confirmación de entrega.
            in: [
              PedidoEstado.RECIBIDO,
              PedidoEstado.EN_PREPARACION,
              PedidoEstado.LISTO_PARA_ENTREGAR,
            ],
          },
        },
        select: {
          id: true,
          estado: true,
          createdAt: true,
          observacionGeneral: true,
          codigoRetiro: true,
          retiroNombre: true,
          mesa: { select: { numero: true } },
          lineas: {
            select: {
              id: true,
              nombreSnapshot: true,
              cantidad: true,
              observacion: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      // BL-244: mismo mapper que usa pedido:nuevo (PedidosService.crear),
      // para que el snapshot y el evento en vivo tengan la misma forma.
      return pedidos.map(aPedidoKds);
    });
  }

  /**
   * BL-448: avisos de efectivo que siguen pendientes, para el KDS que se
   * conecta o se reconecta después de la solicitud (el evento en vivo solo
   * lo reciben los que ya estaban conectados).
   *
   * Pendiente = pedido de mesa en PENDIENTE_PAGO con efectivo_solicitado_en.
   * Cobrado (RECIBIDO o después) o cancelado (al cerrar la mesa) ya no
   * aparece. RLS limita la consulta al tenant.
   */
  async listarSolicitudesEfectivo(
    tenantId: string,
  ): Promise<SolicitudEfectivoPendiente[]> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const pedidos = await tx.pedido.findMany({
        where: {
          estado: PedidoEstado.PENDIENTE_PAGO,
          canal: 'QR',
          efectivoSolicitadoEn: { not: null },
        },
        select: {
          id: true,
          efectivoSolicitadoEn: true,
          efectivoPagaCon: true,
          mesa: { select: { id: true, numero: true } },
          lineas: { select: { subtotal: true } },
        },
        orderBy: { efectivoSolicitadoEn: 'asc' },
      });

      return pedidos.map((pedido) => ({
        mesaId: pedido.mesa.id,
        mesaNumero: pedido.mesa.numero,
        ts: (pedido.efectivoSolicitadoEn as Date).getTime(),
        motivo: 'PAGO_EFECTIVO' as const,
        pedidoId: pedido.id,
        total: pedido.lineas
          .reduce(
            (acumulado, linea) => acumulado.plus(linea.subtotal),
            new Prisma.Decimal(0),
          )
          .toFixed(2),
        pagaCon: pedido.efectivoPagaCon?.toFixed(2) ?? null,
      }));
    });
  }
}
