import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CrearPedidoDto } from './dto/crear-pedido.dto';
import { KdsGateway } from './kds.gateway';

export const ESTADO_INICIAL_PEDIDO = 'RECIBIDO' as const;
const NUMERO_MESA_VIRTUAL = 0;

@Injectable()
export class PedidosService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly kdsGateway: KdsGateway,
  ) {}

  async crear(tenantId: string, dto: CrearPedidoDto) {
    const { pedido, esNuevo } = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const existente = await tx.pedido.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { lineas: true },
        });
        if (existente) {
          return { pedido: existente, esNuevo: false };
        }

        const mesa = dto.mesaId
          ? await tx.mesa.findUnique({ where: { id: dto.mesaId } })
          : await this.obtenerOCrearMesaVirtual(
              tx,
              tenantId,
              dto.restauranteId,
            );

        if (!mesa) {
          throw new NotFoundException(
            'Mesa no encontrada para este establecimiento',
          );
        }

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
            restauranteId: dto.restauranteId,
            mesaId: mesa.id,
            idempotencyKey: dto.idempotencyKey,
            estado: ESTADO_INICIAL_PEDIDO,
            canal: dto.mesaId ? 'QR' : 'WEB',
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
                };
              }),
            },
          },
          include: { lineas: true },
        });

        return { pedido: nuevoPedido, esNuevo: true };
      },
    );

    if (esNuevo) {
      this.kdsGateway.emitirNuevoPedido(tenantId, pedido);
    }

    return pedido;
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
