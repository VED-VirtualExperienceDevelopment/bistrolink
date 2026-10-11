import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CrearPedidoDto } from './dto/crear-pedido.dto';
import { MesaDelQr } from '../qr-mesa/qr-mesa-acceso.service';
import { KdsGateway } from './kds.gateway';
import { aPedidoKds } from './pedido-kds.mapper';

export const ESTADO_INICIAL_PEDIDO = 'RECIBIDO' as const;
const NUMERO_MESA_VIRTUAL = 0;

@Injectable()
export class PedidosService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly kdsGateway: KdsGateway,
  ) {}

  /**
   * @param mesaQr mesa del QR validada por MesaQrGuard (BL-204). Si viene,
   *   el pedido es de esa mesa y de ninguna otra.
   */
  async crear(tenantId: string, dto: CrearPedidoDto, mesaQr?: MesaDelQr) {
    const { pedido, esNuevo, mesaNumero } =
      await this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
        const existente = await tx.pedido.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { lineas: true },
        });
        if (existente) {
          return { pedido: existente, esNuevo: false, mesaNumero: null };
        }

        const { mesa, restauranteId, esPedidoDeMesa } =
          await this.resolverMesaYRestaurante(tx, tenantId, dto, mesaQr);

        const itemsCarta = await tx.itemCarta.findMany({
          where: { id: { in: dto.items.map((i) => i.itemCartaId) } },
        });

        const itemsPorId = new Map(itemsCarta.map((i) => [i.id, i]));
        for (const linea of dto.items) {
          const item = itemsPorId.get(linea.itemCartaId);
          if (!item) {
            throw new BadRequestException(
              `El ítem ${linea.itemCartaId} no existe en la carta de este restaurante`,
            );
          }
          if (!item.disponible) {
            throw new BadRequestException(
              `"${item.nombre}" no está disponible`,
            );
          }
        }

        const nuevoPedido = await tx.pedido.create({
          data: {
            tenantId,
            restauranteId,
            mesaId: mesa.id,
            idempotencyKey: dto.idempotencyKey,
            estado: ESTADO_INICIAL_PEDIDO,
            // BL-204: el canal lo decide el servidor según cómo se resolvió
            // la mesa, no lo que diga el cliente.
            canal: esPedidoDeMesa ? 'QR' : 'WEB',
            observacionGeneral: dto.observacionGeneral,
            lineas: {
              create: dto.items.map((linea) => {
                const item = itemsPorId.get(linea.itemCartaId)!;
                return {
                  tenantId,
                  itemCartaId: item.id,
                  nombreSnapshot: item.nombre,
                  precioUnitarioSnapshot: item.precio,
                  cantidad: linea.cantidad,
                  subtotal: item.precio.mul(linea.cantidad),
                  observacion: linea.observacion,
                };
              }),
            },
          },
          include: { lineas: true },
        });

        return { pedido: nuevoPedido, esNuevo: true, mesaNumero: mesa.numero };
      });

    // BL-244: al KDS se le emite el pedido con la misma forma que el
    // snapshot (mesaNumero incluido), no el objeto crudo de Prisma. La
    // respuesta al comensal (`return pedido`) no cambia.
    if (esNuevo && mesaNumero !== null) {
      this.kdsGateway.emitirNuevoPedido(
        tenantId,
        aPedidoKds({ ...pedido, mesa: { numero: mesaNumero } }),
      );
    }

    return pedido;
  }

  /**
   * BL-309 / BL-204 / BL-308: de qué mesa y de qué restaurante es el pedido.
   *
   * - Pedido de mesa con QR (mesaQr, validado por MesaQrGuard): la mesa es la
   *   del QR. Si el body trae otro mesaId, 403.
   * - Pedido de mesa sin QR (solo mesaId): PROVISORIO hasta el paso 6 de
   *   BL-204, que vuelve obligatorio el token del QR para la mesa.
   * - En los dos casos, el restaurante sale de la mesa, nunca del cliente (si
   *   el body trae otro restauranteId, 403). La mesa tiene que ser de este
   *   tenant (además de RLS) y no puede ser la mesa virtual.
   * - Pedido para retirar (sin mesa): el restauranteId tiene que ser de este
   *   tenant (403 si no) ANTES de tocar la mesa virtual. Sin este chequeo, el
   *   upsert de la mesa 0 podía colgarse del restaurante de otro tenant: RLS
   *   no lo frena y la FK de Postgres no aplica RLS (BL-308).
   */
  private async resolverMesaYRestaurante(
    tx: PrismaClient,
    tenantId: string,
    dto: CrearPedidoDto,
    mesaQr?: MesaDelQr,
  ) {
    if (mesaQr && dto.mesaId && dto.mesaId !== mesaQr.mesaId) {
      throw new ForbiddenException(
        'La mesa del pedido no coincide con la del QR',
      );
    }

    const mesaId = mesaQr?.mesaId ?? dto.mesaId;

    if (mesaId) {
      const mesa = await tx.mesa.findUnique({ where: { id: mesaId } });

      if (mesa?.tenantId !== tenantId || mesa.esVirtual) {
        throw new NotFoundException(
          'Mesa no encontrada para este establecimiento',
        );
      }

      if (dto.restauranteId && dto.restauranteId !== mesa.restauranteId) {
        throw new ForbiddenException(
          'La mesa no pertenece al restaurante indicado',
        );
      }

      return {
        mesa,
        restauranteId: mesa.restauranteId,
        esPedidoDeMesa: true,
      };
    }

    if (!dto.restauranteId) {
      throw new BadRequestException(
        'Se requiere restauranteId para un pedido sin mesa',
      );
    }

    const restaurante = await tx.restaurante.findUnique({
      where: { id: dto.restauranteId },
      select: { tenantId: true },
    });
    if (restaurante?.tenantId !== tenantId) {
      throw new ForbiddenException(
        'Restaurante no válido para este establecimiento',
      );
    }

    const mesa = await this.obtenerOCrearMesaVirtual(
      tx,
      tenantId,
      dto.restauranteId,
    );
    return { mesa, restauranteId: dto.restauranteId, esPedidoDeMesa: false };
  }

  private async obtenerOCrearMesaVirtual(
    tx: PrismaClient,
    tenantId: string,
    restauranteId: string,
  ) {
    return tx.mesa.upsert({
      where: {
        restauranteId_numero: { restauranteId, numero: NUMERO_MESA_VIRTUAL },
      },
      update: {},
      create: {
        tenantId,
        restauranteId,
        numero: NUMERO_MESA_VIRTUAL,
        estado: 'LIBRE',
        esVirtual: true,
      },
    });
  }
}
