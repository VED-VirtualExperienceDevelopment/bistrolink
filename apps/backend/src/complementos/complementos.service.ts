import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PedidoCanal, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService } from '../menu/storage.service';
import { platosMasPedidos } from '../menu/mas-pedidos';
import { FILTRO_CATEGORIAS_DEL_COMENSAL } from '../menu/menu.service';
import { mejoresConsecuentes } from './reglas-complemento';
import { sumarMostradaEnTx } from './metricas-sugerencia';

/** Sin reglas que cumplan, se sugiere el más pedido entre los sugeribles. */
export const CANTIDAD_RESPALDO = 1;

/** De dónde sale la sugerencia (la pantalla lo explica distinto). */
export type OrigenComplementos = 'reglas' | 'popularidad' | 'ninguno';

export interface PlatoSugerido {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: Prisma.Decimal;
  imagenUrl: string | null;
}

export interface RespuestaComplementos {
  origen: OrigenComplementos;
  sugerencias: PlatoSugerido[];
}

const NINGUNO: RespuestaComplementos = { origen: 'ninguno', sugerencias: [] };
const SIN_PLATOS = { origen: 'ninguno' as const, platos: [] as never[] };

/**
 * HU-046 (BL-552): hasta 2 complementos para los platos de un pedido.
 *
 * - Candidatos: platos de la carta del local que el comensal ve (categoría
 *   visible y no archivada, plato no archivado), disponibles, sugeribles,
 *   sin alcohol y que no estén en el pedido. Se vuelve a filtrar acá
 *   aunque las reglas ya lo cumplían: la carta cambia durante el día.
 * - Orden: lift × confianza de las reglas cuyo antecedente está en el
 *   pedido, la mejor regla por consecuente.
 * - Sin reglas: el más pedido entre los candidatos (HU-045).
 * - La respuesta lleva solo los platos sugeridos: nada de otros pedidos ni
 *   de las métricas de las reglas.
 * - En la transacción del tenant (RLS) y con tenant_id explícito.
 * - HU-046 (BL-554): si hay al menos un plato, suma una «mostrada» del día
 *   y del canal. Si eso falla, la sugerencia se devuelve igual.
 */
@Injectable()
export class ComplementosService {
  private readonly logger = new Logger(ComplementosService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
  ) {}

  async sugerir(
    tenantId: string,
    restauranteId: string,
    itemsEnPedido: readonly string[],
    canal: PedidoCanal,
    ahora: Date = new Date(),
  ): Promise<RespuestaComplementos> {
    const enPedido = [...new Set(itemsEnPedido)];
    const elegidos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const restaurante = await tx.restaurante.findFirst({
          where: { id: restauranteId, tenantId },
          select: { id: true },
        });
        if (!restaurante) {
          throw new NotFoundException(
            'Restaurante no encontrado para este establecimiento',
          );
        }

        const candidatos = await tx.itemCarta.findMany({
          where: {
            tenantId,
            archivadoEn: null,
            disponible: true,
            sugerible: true,
            contieneAlcohol: false,
            id: { notIn: enPedido },
            categoria: { restauranteId, ...FILTRO_CATEGORIAS_DEL_COMENSAL },
          },
          select: {
            id: true,
            nombre: true,
            descripcion: true,
            precio: true,
            imagenKey: true,
          },
        });
        if (candidatos.length === 0) return SIN_PLATOS;
        const porId = new Map(candidatos.map((c) => [c.id, c]));
        const platosDe = (ids: readonly string[]) =>
          ids.flatMap((id) => porId.get(id) ?? []);

        const reglas = await tx.reglaComplemento.findMany({
          where: {
            tenantId,
            antecedenteId: { in: enPedido },
            consecuenteId: { in: [...porId.keys()] },
          },
          select: { consecuenteId: true, confianza: true, lift: true },
        });
        const porReglas = mejoresConsecuentes(reglas);
        if (porReglas.length > 0) {
          return { origen: 'reglas' as const, platos: platosDe(porReglas) };
        }

        const populares = await this.populares(
          tx,
          tenantId,
          [...porId.keys()],
          ahora,
        );
        return populares.length > 0
          ? {
              origen: 'popularidad' as const,
              platos: platosDe(populares.slice(0, CANTIDAD_RESPALDO)),
            }
          : SIN_PLATOS;
      },
    );

    if (elegidos.platos.length === 0) return NINGUNO;
    await this.contarMostrada(tenantId, restauranteId, canal);
    return {
      origen: elegidos.origen,
      sugerencias: await Promise.all(
        elegidos.platos.map(async (plato) => ({
          id: plato.id,
          nombre: plato.nombre,
          descripcion: plato.descripcion,
          precio: plato.precio,
          imagenUrl: plato.imagenKey
            ? await this.storage.urlImagenPublica(plato.imagenKey)
            : null,
        })),
      ),
    };
  }

  /** HU-046 (BL-554): una sugerencia mostrada. Nunca lanza. */
  private async contarMostrada(
    tenantId: string,
    restauranteId: string,
    canal: PedidoCanal,
  ): Promise<void> {
    try {
      await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
        sumarMostradaEnTx(tx, tenantId, restauranteId, canal),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo contar la sugerencia mostrada: ${(error as Error).message}`,
      );
    }
  }

  /** El respaldo de popularidad. Si la consulta falla, sin sugerencia. */
  private async populares(
    tx: Parameters<typeof platosMasPedidos>[0],
    tenantId: string,
    candidatos: string[],
    ahora: Date,
  ): Promise<string[]> {
    try {
      return await platosMasPedidos(tx, tenantId, candidatos, ahora);
    } catch (error) {
      this.logger.warn(
        `No se pudo calcular el respaldo de complementos: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
