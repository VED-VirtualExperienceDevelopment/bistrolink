import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PedidoEstado } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

// Subconjunto de transiciones que el KDS puede disparar (RF.03/RNF.05).
// El resto de la máquina de estados (RECIBIDO viene de HU-003, ENTREGADO lo
// confirma el mozo desde su propio panel, CANCELADO es otro módulo) no es
// responsabilidad de este servicio.
const TRANSICIONES_KDS: Partial<Record<PedidoEstado, PedidoEstado[]>> = {
  RECIBIDO: [PedidoEstado.EN_PREPARACION],
  EN_PREPARACION: [PedidoEstado.LISTO_PARA_ENTREGAR],
};

export interface PedidoActualizado {
  id: string;
  estado: PedidoEstado;
  actualizadoEn: string;
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
            in: [PedidoEstado.RECIBIDO, PedidoEstado.EN_PREPARACION],
          },
        },
        include: { mesa: true, lineas: true },
        orderBy: { createdAt: 'asc' },
      });

      return pedidos.map((p) => ({
        id: p.id,
        mesaNumero: p.mesa.numero,
        estado: p.estado,
        createdAt: p.createdAt.toISOString(),
        // observacionGeneral/observacion (HU-021) no existen todavía en el
        // schema de Pedido/LineaPedido — se agregan cuando esa HU se
        // implemente, sin romper este shape.
        lineas: p.lineas.map((l) => ({
          id: l.id,
          nombreSnapshot: l.nombreSnapshot,
          cantidad: l.cantidad,
        })),
      }));
    });
  }
}
