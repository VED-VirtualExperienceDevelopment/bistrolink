import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MesaEstado, PedidoEstado, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { KdsGateway } from '../pedidos/kds.gateway';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { MesaLayoutDto } from './dto/mesa-layout.dto';
import { MesaLayoutItemDto } from './dto/guardar-layout.dto';
import { PlanoDto } from './dto/plano.dto';
import { MesaDelQr } from '../qr-mesa/qr-mesa-acceso.service';

// HU-017 (BL-60): lo que se devuelve y se emite al cambiar el estado.
const SELECT_MESA_ESTADO = {
  id: true,
  numero: true,
  estado: true,
  layout: true,
} as const;

// Pedidos que todavía tienen que salir de cocina: impiden cerrar la mesa.
const ESTADOS_SIN_ENTREGAR: PedidoEstado[] = [
  PedidoEstado.RECIBIDO,
  PedidoEstado.EN_PREPARACION,
  PedidoEstado.LISTO_PARA_ENTREGAR,
];

/** "mesa 3" o "mesas 3, 5", para los mensajes de error del editor. */
function listarMesas(numeros: number[]): string {
  const ordenados = [...numeros].sort((a, b) => a - b).join(', ');
  return numeros.length === 1 ? `mesa ${ordenados}` : `mesas ${ordenados}`;
}

/** HU-028 (BL-173): forma del plano guardado en restaurante.plano. */
export interface PlanoSalon {
  elementos: Array<{
    id: string;
    tipo: string;
    x: number;
    y: number;
    ancho: number;
    alto: number;
    rotacion: number;
  }>;
  zonas: Array<{
    id: string;
    etiqueta: string;
    x: number;
    y: number;
    ancho: number;
    alto: number;
  }>;
}

/** Plano de un restaurante que todavía no tiene elementos ni zonas. */
export const PLANO_VACIO: PlanoSalon = { elementos: [], zonas: [] };

/**
 * HU-028 (BL-173): arma el JSON a guardar campo por campo, con los datos ya
 * validados por PlanoDto. Así en la base solo queda la forma esperada, sin
 * depender de que el ValidationPipe haya descartado propiedades extra.
 */
function aJsonPlano(plano: PlanoDto): PlanoSalon {
  return {
    elementos: plano.elementos.map(
      ({ id, tipo, x, y, ancho, alto, rotacion }) => ({
        id,
        tipo,
        x,
        y,
        ancho,
        alto,
        rotacion,
      }),
    ),
    zonas: plano.zonas.map(({ id, etiqueta, x, y, ancho, alto }) => ({
      id,
      etiqueta,
      x,
      y,
      ancho,
      alto,
    })),
  };
}

@Injectable()
export class MesasService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly kdsGateway: KdsGateway,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * HU-019 / HU-034 (BL-204): avisa al mozo desde la mesa del QR.
   *
   * @param mesaQr mesa del QR, ya validada por MesaQrGuard: existe, no es la
   *   mesa virtual, el QR está vigente y es del mismo tenant que el JWT. Por
   *   eso no se vuelve a consultar la base: el número de mesa viene del QR
   *   resuelto, no del cliente.
   */
  llamarMozo(tenantId: string, mesaQr: MesaDelQr) {
    this.kdsGateway.emitirLlamado(tenantId, mesaQr.mesaId, mesaQr.numero);
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
   * HU-028 (BL-173): elementos fijos y zonas del restaurante. Si nunca se
   * guardó un plano, devuelve uno vacío: así un mapa de HU-016 (solo mesas)
   * se dibuja igual que antes.
   */
  async obtenerPlano(tenantId: string, restauranteId: string) {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const restaurante = await tx.restaurante.findUnique({
        where: { id: restauranteId },
        select: { tenantId: true, plano: true },
      });

      // Mismo chequeo explícito de tenant que guardarLayout (TC-I-033).
      if (restaurante?.tenantId !== tenantId) {
        throw new NotFoundException(
          'Restaurante no encontrado para este establecimiento',
        );
      }

      return (restaurante.plano as unknown as PlanoSalon | null) ?? PLANO_VACIO;
    });
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
   *
   * HU-028 (BL-173): `plano` (elementos fijos y zonas) se guarda en la misma
   * transacción. Si no viene, el plano guardado no se toca.
   */
  async guardarLayout(
    tenantId: string,
    restauranteId: string,
    mesas: MesaLayoutItemDto[],
    eliminar: string[] = [],
    plano?: PlanoDto,
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

      if (plano !== undefined) {
        await tx.restaurante.update({
          where: { id: restauranteId },
          data: {
            plano: aJsonPlano(plano) as unknown as Prisma.InputJsonValue,
          },
        });
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
   * HU-017 (BL-60): el mozo abre la sesión de la mesa al recibir comensales.
   * Solo desde LIBRE (una mesa que requiere limpieza primero se marca
   * limpia). Cada apertura tiene un id de sesión nuevo: el QR impreso vuelve
   * a servir, pero solo con esta sesión.
   */
  async abrirSesion(tenantId: string, mesaId: string) {
    const mesa = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const actual = await this.mesaFisica(tx, mesaId);
        if (actual.estado !== MesaEstado.LIBRE) {
          throw new ConflictException(
            actual.estado === MesaEstado.REQUIERE_LIMPIEZA
              ? 'La mesa requiere limpieza: marcala como limpia antes de abrirla'
              : 'La mesa ya está abierta',
          );
        }
        // Condicional: si otro mozo la abrió al mismo tiempo, no se pisa.
        const { count } = await tx.mesa.updateMany({
          where: { id: mesaId, estado: MesaEstado.LIBRE },
          data: {
            estado: MesaEstado.OCUPADA,
            sesionId: randomUUID(),
            sesionAbiertaEn: new Date(),
          },
        });
        if (count === 0) {
          throw new ConflictException('La mesa ya está abierta');
        }
        return tx.mesa.findUniqueOrThrow({
          where: { id: mesaId },
          select: SELECT_MESA_ESTADO,
        });
      },
    );
    this.kdsGateway.emitirEstadoMesa(tenantId, mesa.id, mesa.estado);
    return mesa;
  }

  /**
   * HU-017 (BL-60): cierra la sesión de la mesa. Solo si no hay un cobro en
   * curso ni pedidos sin entregar (409). Los pedidos que quedaron esperando
   * el pago (nunca llegaron a cocina ni se cobraron) se cancelan. La mesa
   * pasa a REQUIERE_LIMPIEZA y el QR deja de servir para pedir.
   */
  async cerrarSesion(
    tenantId: string,
    mesaId: string,
    usuarioKeycloakId: string,
  ) {
    const resultado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const actual = await this.mesaFisica(tx, mesaId);
        if (!actual.sesionId) {
          throw new ConflictException('La mesa no está abierta');
        }
        if (actual.estado === MesaEstado.EN_PROCESO_DE_PAGO) {
          throw new ConflictException(
            'Hay un pago en curso en esta mesa: esperá a que termine',
          );
        }

        const sinEntregar = await tx.pedido.count({
          where: { mesaId, estado: { in: ESTADOS_SIN_ENTREGAR } },
        });
        if (sinEntregar > 0) {
          throw new ConflictException(
            sinEntregar === 1
              ? 'Hay 1 pedido sin entregar: no se puede cerrar la mesa'
              : `Hay ${sinEntregar} pedidos sin entregar: no se puede cerrar la mesa`,
          );
        }

        // Condicional: si justo empezó un cobro o la cerró otro mozo, no se
        // pisa (409).
        const { count } = await tx.mesa.updateMany({
          where: {
            id: mesaId,
            sesionId: actual.sesionId,
            estado: MesaEstado.OCUPADA,
          },
          data: {
            estado: MesaEstado.REQUIERE_LIMPIEZA,
            sesionId: null,
            sesionAbiertaEn: null,
          },
        });
        if (count === 0) {
          throw new ConflictException(
            'La mesa cambió mientras se cerraba: probá de nuevo',
          );
        }

        const pedidosCancelados = await this.cancelarSinPagar(
          tx,
          tenantId,
          mesaId,
          usuarioKeycloakId,
        );
        const mesa = await tx.mesa.findUniqueOrThrow({
          where: { id: mesaId },
          select: SELECT_MESA_ESTADO,
        });
        return { mesa, pedidosCancelados };
      },
    );
    this.kdsGateway.emitirEstadoMesa(
      tenantId,
      resultado.mesa.id,
      resultado.mesa.estado,
    );
    return resultado;
  }

  /** HU-017 (BL-60): después de cerrar, el mozo la marca limpia (LIBRE). */
  async marcarLimpia(tenantId: string, mesaId: string) {
    const mesa = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        await this.mesaFisica(tx, mesaId);
        const { count } = await tx.mesa.updateMany({
          where: { id: mesaId, estado: MesaEstado.REQUIERE_LIMPIEZA },
          data: { estado: MesaEstado.LIBRE },
        });
        if (count === 0) {
          throw new ConflictException('La mesa no está esperando limpieza');
        }
        return tx.mesa.findUniqueOrThrow({
          where: { id: mesaId },
          select: SELECT_MESA_ESTADO,
        });
      },
    );
    this.kdsGateway.emitirEstadoMesa(tenantId, mesa.id, mesa.estado);
    return mesa;
  }

  // La mesa del tenant (RLS + 404) que no sea la virtual de los pedidos para
  // retirar: esa no tiene sesión.
  private async mesaFisica(tx: Prisma.TransactionClient, mesaId: string) {
    const mesa = await tx.mesa.findUnique({
      where: { id: mesaId },
      select: { id: true, estado: true, sesionId: true, esVirtual: true },
    });
    if (!mesa) {
      throw new NotFoundException(
        'Mesa no encontrada para este establecimiento',
      );
    }
    if (mesa.esVirtual) {
      throw new BadRequestException(
        'La mesa de los pedidos para retirar no se abre ni se cierra',
      );
    }
    return mesa;
  }

  // Pedidos de la mesa que esperaban el pago (prepago, RD.03): pasan a
  // CANCELADO, con su historial. Nunca llegaron a cocina ni se cobraron.
  private async cancelarSinPagar(
    tx: Prisma.TransactionClient,
    tenantId: string,
    mesaId: string,
    usuarioKeycloakId: string,
  ): Promise<number> {
    const pendientes = await tx.pedido.findMany({
      where: { mesaId, estado: PedidoEstado.PENDIENTE_PAGO },
      select: { id: true },
    });
    if (pendientes.length === 0) return 0;

    const usuario = await tx.usuario.findUnique({
      where: { keycloakId: usuarioKeycloakId },
      select: { id: true },
    });
    const ids = pendientes.map((p) => p.id);
    await tx.pedido.updateMany({
      where: { id: { in: ids }, estado: PedidoEstado.PENDIENTE_PAGO },
      data: { estado: PedidoEstado.CANCELADO },
    });
    await tx.pedidoEstadoHistorial.createMany({
      data: ids.map((pedidoId) => ({
        tenantId,
        pedidoId,
        usuarioId: usuario?.id ?? null,
        estadoAnterior: PedidoEstado.PENDIENTE_PAGO,
        estadoNuevo: PedidoEstado.CANCELADO,
      })),
    });
    // HU-035 (BL-205): las cancelaciones quedan en la auditoría, en la misma
    // transacción del cierre.
    await this.auditLog.registrarEnTx(tx, {
      action: AuditAction.MESA_PEDIDOS_CANCELADOS,
      tenantId,
      actorKeycloakId: usuarioKeycloakId,
      entidadId: mesaId,
      detalle: { motivo: 'cierre de la mesa', pedidosCancelados: ids },
    });
    return ids.length;
  }
}
