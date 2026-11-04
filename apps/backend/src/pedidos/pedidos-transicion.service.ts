import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PedidoEstado, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { aPedidoKds } from './pedido-kds.mapper';
import type { LlamadoPagoEfectivo } from './kds.gateway';

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
  }): Promise<PedidoActualizado> {
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

      return {
        id: actualizado.id,
        estado: actualizado.estado,
        actualizadoEn: actualizado.updatedAt.toISOString(),
        mesaNumero: actualizado.mesa.numero,
        lineas: actualizado.lineas,
      };
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
