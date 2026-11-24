import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PedidoEstado, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  diaEnZona,
  resolverPeriodo,
  type RangoDias,
} from '../reportes/periodos-reportes';
import { FiltrosValoracionesDto } from './dto/filtros-valoraciones.dto';
import { ValorarPedidoDto } from './dto/valorar-pedido.dto';
import {
  CODIGO_YA_VALORADO,
  MAXIMO_COMENTARIOS,
  MENSAJE_AUN_NO_ENTREGADO,
  MENSAJE_YA_VALORADO,
  resumirValoraciones,
  type ResumenValoraciones,
} from './valoracion';

export interface ComentarioValoracion {
  /** Día del calendario del local (AAAA-MM-DD), sin hora. */
  dia: string;
  estrellas: number;
  comentario: string;
}

export interface ValoracionesDelPeriodo extends ResumenValoraciones {
  rango: RangoDias & { timezone: string };
  /** Los más recientes primero, hasta MAXIMO_COMENTARIOS. */
  comentarios: ComentarioValoracion[];
  /** Cuántas valoraciones del período tienen comentario (pueden ser más). */
  totalComentarios: number;
}

/** El día (AAAA-MM-DD) como lo guarda una columna DATE de Prisma. */
function comoFecha(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

/**
 * HU-050 (BL-558): valoración privada del pedido.
 *
 * - El comensal valora una vez, después de la entrega. El acceso al pedido
 *   ya lo validó PedidoAccesoGuard (RD.05); acá se controla el estado.
 * - El Administrador ve el promedio, la distribución y los comentarios del
 *   período, sin el pedido ni la mesa (E1).
 *
 * Todo dentro de runInTenantContext (RLS) y con tenant_id explícito.
 */
@Injectable()
export class ValoracionesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async valorar(
    tenantId: string,
    pedidoId: string,
    dto: ValorarPedidoDto,
    ahora: Date = new Date(),
  ): Promise<{ valorado: true }> {
    try {
      return await this.tenantPrisma.runInTenantContext(
        tenantId,
        async (tx) => {
          const pedido = await tx.pedido.findUnique({
            where: { id: pedidoId },
            select: {
              estado: true,
              restaurante: { select: { timezone: true } },
            },
          });
          if (!pedido) {
            throw new NotFoundException('Pedido no encontrado');
          }
          if (pedido.estado !== PedidoEstado.ENTREGADO) {
            throw new ConflictException(MENSAJE_AUN_NO_ENTREGADO);
          }
          await tx.valoracionPedido.create({
            data: {
              pedidoId,
              tenantId,
              dia: comoFecha(diaEnZona(ahora, pedido.restaurante.timezone)),
              estrellas: dto.estrellas,
              comentario: dto.comentario ?? null,
            },
          });
          return { valorado: true as const };
        },
      );
    } catch (err) {
      // La clave es el pedido: la segunda valoración choca con la primera
      // (también si llegan las dos a la vez).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          statusCode: 409,
          codigo: CODIGO_YA_VALORADO,
          message: MENSAJE_YA_VALORADO,
        });
      }
      throw err;
    }
  }

  async listar(
    tenantId: string,
    filtros: FiltrosValoracionesDto,
    ahora: Date = new Date(),
  ): Promise<ValoracionesDelPeriodo> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const restaurante = await tx.restaurante.findFirst({
        where: { tenantId },
        select: { timezone: true },
      });
      if (!restaurante) {
        throw new NotFoundException('Establecimiento no encontrado');
      }
      const { timezone } = restaurante;
      const rango = resolverPeriodo(filtros.periodo, timezone, ahora, {
        desde: filtros.desde,
        hasta: filtros.hasta,
      });
      const delPeriodo = {
        tenantId,
        dia: { gte: comoFecha(rango.desde), lte: comoFecha(rango.hasta) },
      };

      const conteos = await tx.valoracionPedido.groupBy({
        by: ['estrellas'],
        where: delPeriodo,
        _count: { _all: true },
      });
      const conComentario = { ...delPeriodo, comentario: { not: null } };
      const totalComentarios = await tx.valoracionPedido.count({
        where: conComentario,
      });
      // Sin el pedido y en un orden que no sigue al de las entregas: por día
      // y, dentro del día, por estrellas y texto.
      const filas = await tx.valoracionPedido.findMany({
        where: conComentario,
        select: { dia: true, estrellas: true, comentario: true },
        orderBy: [{ dia: 'desc' }, { estrellas: 'asc' }, { comentario: 'asc' }],
        take: MAXIMO_COMENTARIOS,
      });

      return {
        rango: { ...rango, timezone },
        ...resumirValoraciones(
          conteos.map((c) => ({
            estrellas: c.estrellas,
            cantidad: c._count._all,
          })),
        ),
        comentarios: filas.map((f) => ({
          dia: f.dia.toISOString().slice(0, 10),
          estrellas: f.estrellas,
          comentario: f.comentario ?? '',
        })),
        totalComentarios,
      };
    });
  }
}
