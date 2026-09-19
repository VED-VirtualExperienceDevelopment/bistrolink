import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MesaEstado, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { KdsGateway } from '../pedidos/kds.gateway';
import { MesaLayoutDto } from './dto/mesa-layout.dto';
import { MesaLayoutItemDto } from './dto/guardar-layout.dto';

@Injectable()
export class MesasService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly kdsGateway: KdsGateway,
  ) {}

  async llamarMozo(tenantId: string, mesaId: string) {
    const mesa = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.mesa.findUnique({
        where: { id: mesaId },
        select: { id: true, numero: true },
      }),
    );

    if (!mesa) {
      throw new NotFoundException(
        'Mesa no encontrada para este establecimiento',
      );
    }

    this.kdsGateway.emitirLlamado(tenantId, mesa.id, mesa.numero);

    return { ok: true };
  }

  /**
   * HU-016: mesas del restaurante con su layout + estado actual, para
   * pintar el mapa visual. Excluye la mesa virtual de HU-003 (numero=0,
   * es_virtual=true): no representa una mesa física y nunca se dibuja en
   * el editor.
   */
  async obtenerLayout(tenantId: string, restauranteId: string) {
    return this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.mesa.findMany({
        where: { tenantId, restauranteId, esVirtual: false },
        select: {
          id: true,
          numero: true,
          estado: true,
          layout: true,
        },
        orderBy: { numero: 'asc' },
      }),
    );
  }

  /**
   * HU-016: guardado masivo del mapa completo desde el editor visual — el
   * caso de uso natural es "arrastrar N mesas y guardar una vez". Corre
   * dentro de una única transacción tenant-scoped (runInTenantContext ya la
   * abre), así que un guardado parcial nunca deja el mapa a medio mover.
   */
  async guardarLayout(
    tenantId: string,
    restauranteId: string,
    mesas: MesaLayoutItemDto[],
  ) {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const resultado = [];

      for (const item of mesas) {
        const { id, numero, ...layout } = item;

        if (id) {
          // Defensa en profundidad: además de RLS, se verifica de forma
          // explícita que la mesa sea de este tenant Y de este restaurante
          // antes de tocarla — evita que un id de otro restaurante del
          // mismo tenant (o de otro tenant) se cuele en el bulk save.
          const existente = await tx.mesa.findUnique({
            where: { id },
            select: { id: true, tenantId: true, restauranteId: true },
          });

          if (
            existente?.tenantId !== tenantId ||
            existente?.restauranteId !== restauranteId
          ) {
            throw new NotFoundException(
              `Mesa ${id} no encontrada para este establecimiento`,
            );
          }

          resultado.push(
            await tx.mesa.update({
              where: { id },
              // Cast necesario: Prisma tipa los campos Json como
              // InputJsonObject (exige index signature [key: string]:
              // JsonValue), y un DTO de clase no la tiene aunque en runtime
              // sea un objeto plano — mismo motivo que en
              // actualizarLayoutMesa más abajo.
              data: { layout: layout as unknown as Prisma.InputJsonValue },
              select: { id: true, numero: true, estado: true, layout: true },
            }),
          );
          continue;
        }

        try {
          resultado.push(
            await tx.mesa.create({
              data: {
                tenantId,
                restauranteId,
                numero,
                estado: MesaEstado.LIBRE,
                layout: layout as unknown as Prisma.InputJsonValue,
              },
              select: { id: true, numero: true, estado: true, layout: true },
            }),
          );
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new ConflictException(
              `Ya existe una mesa con el número ${numero} en este restaurante`,
            );
          }
          throw err;
        }
      }

      return resultado;
    });
  }

  /**
   * HU-016: actualización puntual del layout de UNA mesa (PUT /mesas/:id).
   * Nunca toca `numero` ni `estado` — eso queda fuera del alcance del
   * editor visual (numero se define al crear la mesa, estado es de HU-017).
   */
  async actualizarLayoutMesa(
    tenantId: string,
    mesaId: string,
    layout: MesaLayoutDto,
  ) {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const existente = await tx.mesa.findUnique({
        where: { id: mesaId },
        select: { id: true },
      });

      if (!existente) {
        throw new NotFoundException(
          'Mesa no encontrada para este establecimiento',
        );
      }

      return tx.mesa.update({
        where: { id: mesaId },
        // Ver comentario en guardarLayout: Prisma exige InputJsonObject
        // (con index signature) para un campo Json, y MesaLayoutDto es una
        // clase con propiedades tipadas explícitas — no la tiene aunque en
        // runtime sea un objeto plano ya validado por class-validator.
        data: { layout: layout as unknown as Prisma.InputJsonValue },
        select: { id: true, numero: true, estado: true, layout: true },
      });
    });
  }

  /**
   * Punto de entrada para cambiar el estado de una mesa y notificarlo por
   * WebSocket. HU-017 va a llamar este mismo método desde el ciclo de vida
   * de pedidos/pagos; hasta entonces lo dispara el endpoint mock
   * PATCH /mesas/:id/estado (ver ActualizarEstadoMesaDto).
   */
  async actualizarEstado(
    tenantId: string,
    mesaId: string,
    nuevoEstado: MesaEstado,
  ) {
    const mesa = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const existente = await tx.mesa.findUnique({
          where: { id: mesaId },
          select: { id: true },
        });

        if (!existente) {
          throw new NotFoundException(
            'Mesa no encontrada para este establecimiento',
          );
        }

        return tx.mesa.update({
          where: { id: mesaId },
          data: { estado: nuevoEstado },
          select: { id: true, numero: true, estado: true, layout: true },
        });
      },
    );

    this.kdsGateway.emitirEstadoMesa(tenantId, mesa.id, mesa.estado);

    return mesa;
  }
}
