import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MesaEstado, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { KdsGateway } from '../pedidos/kds.gateway';
import { MesaLayoutDto } from './dto/mesa-layout.dto';
import { MesaLayoutItemDto } from './dto/guardar-layout.dto';

/** "mesa 3" o "mesas 3, 5", para los mensajes de error del editor. */
function listarMesas(numeros: number[]): string {
  const ordenados = [...numeros].sort((a, b) => a - b).join(', ');
  return numeros.length === 1 ? `mesa ${ordenados}` : `mesas ${ordenados}`;
}

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
   *
   * BL-58: `eliminar` son ids de mesas que el administrador quitó del mapa.
   * Se borran primero (así una mesa nueva puede reusar el número de una
   * borrada) y solo si están LIBRES y sin pedidos. Si alguna no se puede
   * borrar, se rechaza el guardado completo con 409 y no cambia nada.
   */
  async guardarLayout(
    tenantId: string,
    restauranteId: string,
    mesas: MesaLayoutItemDto[],
    eliminar: string[] = [],
  ) {
    const idsActualizados = new Set(mesas.flatMap((m) => (m.id ? [m.id] : [])));
    if (eliminar.some((id) => idsActualizados.has(id))) {
      throw new BadRequestException(
        'Una mesa no puede actualizarse y eliminarse en el mismo guardado',
      );
    }

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      // El restaurante tiene que ser de este tenant. Sin este chequeo, una
      // mesa nueva (sin id) se crearía con el tenantId propio colgada del
      // restaurante de OTRO tenant: RLS no lo frena (el tenant_id de la fila
      // es el correcto) y la FK de Postgres no aplica RLS. Detectado por
      // TC-I-033. Se compara tenantId de forma explícita, además de RLS.
      const restaurante = await tx.restaurante.findUnique({
        where: { id: restauranteId },
        select: { tenantId: true },
      });

      if (restaurante?.tenantId !== tenantId) {
        throw new NotFoundException(
          'Restaurante no encontrado para este establecimiento',
        );
      }

      if (eliminar.length > 0) {
        await this.eliminarMesas(tx, tenantId, restauranteId, eliminar);
      }

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
   * BL-58: borrado físico de mesas desde el editor del mapa. Una mesa con
   * pedidos no se puede borrar (Pedido.mesaId es FK obligatoria y el
   * historial de pedidos, pagos y comprobantes tiene que conservarse), y una
   * mesa ocupada o en proceso de pago tampoco, aunque todavía no tenga
   * pedidos. La mesa virtual de HU-003 nunca aparece en el mapa, así que se
   * trata como no encontrada.
   */
  private async eliminarMesas(
    tx: Prisma.TransactionClient,
    tenantId: string,
    restauranteId: string,
    ids: string[],
  ) {
    const encontradas = await tx.mesa.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        numero: true,
        estado: true,
        esVirtual: true,
        tenantId: true,
        restauranteId: true,
        _count: { select: { pedidos: true } },
      },
    });
    const porId = new Map(encontradas.map((m) => [m.id, m]));

    // Misma defensa en profundidad que en las actualizaciones: además de
    // RLS, la mesa tiene que ser de este tenant y de este restaurante.
    for (const id of ids) {
      const mesa = porId.get(id);
      if (
        mesa?.tenantId !== tenantId ||
        mesa?.restauranteId !== restauranteId ||
        mesa?.esVirtual
      ) {
        throw new NotFoundException(
          `Mesa ${id} no encontrada para este establecimiento`,
        );
      }
    }

    const noLibres = encontradas
      .filter((m) => m.estado !== MesaEstado.LIBRE)
      .map((m) => m.numero);
    if (noLibres.length > 0) {
      throw new ConflictException(
        `No se pueden eliminar del mapa mesas que no están libres (${listarMesas(noLibres)}). Esperá a que queden libres.`,
      );
    }

    const conPedidos = encontradas
      .filter((m) => m._count.pedidos > 0)
      .map((m) => m.numero);
    if (conPedidos.length > 0) {
      throw new ConflictException(
        `No se pueden eliminar del mapa mesas con pedidos registrados (${listarMesas(conPedidos)}).`,
      );
    }

    try {
      await tx.mesa.deleteMany({
        where: { id: { in: ids }, tenantId, restauranteId },
      });
    } catch (err) {
      // Carrera: entró un pedido entre el chequeo y el borrado.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(
          'No se pueden eliminar del mapa mesas con pedidos registrados.',
        );
      }
      throw err;
    }
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
