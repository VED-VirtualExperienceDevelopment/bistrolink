import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient, MesaEstado } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CrearPedidoDto } from './dto/crear-pedido.dto';
import { MesaDelQr } from '../qr-mesa/qr-mesa-acceso.service';
import { KdsGateway } from './kds.gateway';
import { aPedidoKds, PedidoParaKds } from './pedido-kds.mapper';
import { generarTokenAcceso } from './token-acceso-pedido';

// BL-311 (RD.03, prepago): el pedido espera el pago aprobado antes de ir a
// cocina. La transición a RECIBIDO la hace la confirmación del pago.
export const ESTADO_INICIAL_PEDIDO = 'PENDIENTE_PAGO' as const;
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
    // BL-311 (RD.05): token de acceso, solo para pedidos para retirar (WEB).
    // Los de mesa se autorizan con el QR. Se genera afuera de la transacción
    // para devolverlo en claro: en la base queda solo el hash.
    const acceso = generarTokenAcceso();

    const { pedido } = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const existente = await tx.pedido.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { lineas: true },
        });
        if (existente) {
          // Reintento con la misma clave (el cliente no recibió la primera
          // respuesta): el token en claro no se puede recuperar, así que se
          // emite uno nuevo y el anterior deja de valer.
          if (existente.canal === 'WEB') {
            await tx.pedido.update({
              where: { id: existente.id },
              data: { accesoTokenHash: acceso.hash },
            });
          }
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
            accesoTokenHash: esPedidoDeMesa ? null : acceso.hash,
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
      },
    );

    // BL-311 (RD.03, prepago): el pedido NO va al KDS al crearse. Llega a
    // cocina cuando se aprueba el pago (confirmarPagoEnTx + notificarPedidoConfirmado).

    // El hash nunca sale del backend. Al comensal de un pedido para retirar
    // se le devuelve el token en claro: lo manda en X-Pedido-Token para pagar
    // y consultar el comprobante.
    const respuesta: Omit<typeof pedido, 'accesoTokenHash'> &
      Partial<Pick<typeof pedido, 'accesoTokenHash'>> = { ...pedido };
    delete respuesta.accesoTokenHash;
    return pedido.canal === 'WEB'
      ? { ...respuesta, tokenAcceso: acceso.token }
      : respuesta;
  }

  /**
   * BL-311 (RD.03, prepago): el pago del pedido se aprobó. Pasa de
   * PENDIENTE_PAGO a RECIBIDO y deja el cambio en el historial.
   *
   * Corre DENTRO de la transacción de quien confirma el pago (PagosService o
   * el webhook de Mercado Pago), para que el pago aprobado y el pedido en
   * RECIBIDO se guarden juntos o no se guarde ninguno.
   *
   * Idempotente: si el pedido ya no está en PENDIENTE_PAGO (la respuesta
   * directa y el webhook llegan los dos), devuelve null y no hace nada. El
   * que recibe el pedido es el que avisa a cocina (notificarPedidoConfirmado),
   * así el KDS no recibe el mismo pedido dos veces.
   */
  async confirmarPagoEnTx(
    tx: PrismaClient,
    tenantId: string,
    pedidoId: string,
  ): Promise<PedidoParaKds | null> {
    const { count } = await tx.pedido.updateMany({
      where: { id: pedidoId, estado: 'PENDIENTE_PAGO' },
      data: { estado: 'RECIBIDO' },
    });
    if (count === 0) {
      return null;
    }

    // Sin usuario: el cambio lo dispara el pago, no una persona del staff.
    await tx.pedidoEstadoHistorial.create({
      data: {
        tenantId,
        pedidoId,
        estadoAnterior: 'PENDIENTE_PAGO',
        estadoNuevo: 'RECIBIDO',
      },
    });

    return tx.pedido.findUniqueOrThrow({
      where: { id: pedidoId },
      select: {
        id: true,
        estado: true,
        createdAt: true,
        updatedAt: true,
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
    });
  }

  /**
   * HU-017 (BL-60): avisa al mapa de mesas que la mesa cambió de estado al
   * empezar o terminar un cobro (EN_PROCESO_DE_PAGO / OCUPADA). Igual que
   * notificarPedidoConfirmado, se llama después de confirmar la transacción.
   */
  notificarEstadoMesa(tenantId: string, mesaId: string, estado: MesaEstado) {
    this.kdsGateway.emitirEstadoMesa(tenantId, mesaId, estado);
  }

  /**
   * BL-311: avisa que el pedido ya está pago. Se llama DESPUÉS de confirmar
   * la transacción (nunca adentro): si la transacción se revierte, cocina no
   * tiene que haber visto el pedido.
   * - Al KDS (sala del tenant): `pedido:nuevo`, con la forma de BL-244.
   * - Al comensal que sigue el pedido (sala del pedido): `pedido:actualizado`.
   */
  notificarPedidoConfirmado(
    tenantId: string,
    pedido: PedidoParaKds & { updatedAt?: Date },
  ) {
    this.kdsGateway.emitirNuevoPedido(tenantId, aPedidoKds(pedido));
    this.kdsGateway.emitirActualizacionPedido(pedido.id, {
      id: pedido.id,
      estado: pedido.estado,
      actualizadoEn: (pedido.updatedAt ?? new Date()).toISOString(),
    });
  }

  /**
   * BL-309 / BL-204 / BL-308: de qué mesa y de qué restaurante es el pedido.
   *
   * - Pedido de mesa: la mesa sale SOLO del QR (mesaQr, validado por
   *   MesaQrGuard). El body no acepta mesaId (CrearPedidoDto): no hay forma
   *   de pedir a nombre de otra mesa.
   * - El restaurante sale de la mesa, nunca del cliente (si el body trae
   *   otro restauranteId, 403). La mesa se vuelve a leer dentro de la
   *   transacción: tiene que ser de este tenant (además de RLS) y no puede
   *   ser la mesa virtual.
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
    if (mesaQr) {
      const mesa = await tx.mesa.findUnique({ where: { id: mesaQr.mesaId } });

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
