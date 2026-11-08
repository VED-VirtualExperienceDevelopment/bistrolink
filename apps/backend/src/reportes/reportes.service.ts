import { Injectable, NotFoundException } from '@nestjs/common';
import { PedidoCanal, Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CanalReporte, FiltrosReportesDto } from './dto/filtros-reportes.dto';
import {
  aplicaRotacion,
  CANALES_DEL_FILTRO,
  canalesDelFiltro,
  periodoAnterior,
  RangoDias,
  resolverPeriodo,
} from './periodos-reportes';

/** HU-012 (BL-108): cuántos platos muestra el ranking. */
export const TOP_PLATOS = 10;

export interface TotalesVentas {
  totalVendido: number;
  pedidos: number;
}

export interface VentaPorHora {
  /** Hora del día en la zona del local (0 a 23). */
  hora: number;
  monto: number;
  pedidos: number;
}

export interface PlatoVendido {
  itemCartaId: string;
  nombre: string;
  cantidad: number;
  recaudado: number;
}

export type RotacionMesas =
  | { aplica: false }
  | {
      aplica: true;
      /** Sesiones de mesa cerradas en el período (turnos). */
      sesiones: number;
      /** Mesas físicas del local (sin la virtual). */
      mesas: number;
      /** Turnos por mesa en el período. */
      rotacion: number;
      /** Tiempo promedio de ocupación, en minutos. */
      ocupacionPromedioMin: number;
    };

export interface ReporteVentas {
  rango: RangoDias & { timezone: string };
  canal: CanalReporte;
  resumen: TotalesVentas & {
    ticketPromedio: number;
    anterior: TotalesVentas;
  };
  /**
   * Ventas dentro y fuera del local, siempre de todos los canales. `pos`
   * (BL-489): las hechas directamente en el POS del local.
   */
  porLugar: { local: number; web: number; whatsapp: number; pos: number };
  ventasPorHora: VentaPorHora[];
  platosMasPedidos: {
    porCantidad: PlatoVendido[];
    porRecaudado: PlatoVendido[];
  };
  rotacionMesas: RotacionMesas;
}

/** Un número que viene de la base: SUM y AVG llegan como Decimal (o null). */
type NumeroDeLaBase = Prisma.Decimal | number | null;

/** Columnas de fecha por las que se filtra el período. */
const COLUMNA_HORA = Prisma.raw('hora');
const COLUMNA_CERRADA_EN = Prisma.raw('cerrada_en');

interface FilaCanal {
  canal: PedidoCanal;
  monto: NumeroDeLaBase;
  pedidos: number | null;
}

interface FilaHora {
  hora: number;
  monto: NumeroDeLaBase;
  pedidos: number | null;
}

interface FilaPlato {
  item_carta_id: string;
  nombre: string;
  cantidad: number;
  recaudado: NumeroDeLaBase;
}

interface FilaRotacion {
  sesiones: number;
  minutos: NumeroDeLaBase;
}

/** Pesos con 2 decimales (los SUM de la base llegan como Decimal). */
function pesos(valor: NumeroDeLaBase): number {
  return Math.round(Number(valor ?? 0) * 100) / 100;
}

function unDecimal(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/** Suma los montos y pedidos de los canales que entran en el filtro. */
function totales(
  filas: FilaCanal[],
  canales: readonly PedidoCanal[] | null,
): TotalesVentas {
  const incluidas = filas.filter((f) => !canales || canales.includes(f.canal));
  return {
    totalVendido: pesos(
      incluidas.reduce((suma, f) => suma + Number(f.monto ?? 0), 0),
    ),
    pedidos: incluidas.reduce((suma, f) => suma + Number(f.pedidos ?? 0), 0),
  };
}

/**
 * HU-012 (BL-108): métricas del dashboard de reportes.
 *
 * - Ventas y platos salen SOLO de las tablas de resumen (BL-219), nunca de
 *   pago ni de linea_pedido. La rotación sale del historial sesion_mesa.
 * - Los días del período son del calendario del local (restaurante.timezone):
 *   se pasan a instantes en la base (`día::timestamp AT TIME ZONE zona`), así
 *   el filtro por `hora` usa la clave primaria del resumen.
 * - Dentro del contexto del tenant (RLS) y además con tenant_id en cada
 *   consulta (BL-110). Todo con parámetros (Prisma.sql), nunca concatenando
 *   texto.
 */
@Injectable()
export class ReportesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async obtener(
    tenantId: string,
    filtros: FiltrosReportesDto,
    ahora: Date = new Date(),
  ): Promise<ReporteVentas> {
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
      const canales = canalesDelFiltro(filtros.canal);
      const consulta = new ConsultaReportes(tx, tenantId, timezone);

      const porCanal = await consulta.ventasPorCanal(rango);
      const porCanalAnterior = await consulta.ventasPorCanal(
        periodoAnterior(rango),
      );
      const actual = totales(porCanal, canales);
      const platos = await consulta.platos(rango, canales);

      return {
        rango: { ...rango, timezone },
        canal: filtros.canal,
        resumen: {
          ...actual,
          ticketPromedio:
            actual.pedidos > 0
              ? pesos(actual.totalVendido / actual.pedidos)
              : 0,
          anterior: totales(porCanalAnterior, canales),
        },
        porLugar: {
          local: totales(porCanal, CANALES_DEL_FILTRO.LOCAL).totalVendido,
          web: totales(porCanal, CANALES_DEL_FILTRO.WEB).totalVendido,
          whatsapp: totales(porCanal, CANALES_DEL_FILTRO.WHATSAPP).totalVendido,
          pos: totales(porCanal, CANALES_DEL_FILTRO.POS).totalVendido,
        },
        ventasPorHora: await consulta.ventasPorHora(rango, canales),
        platosMasPedidos: {
          porCantidad: [...platos]
            .sort(
              (a, b) => b.cantidad - a.cantidad || b.recaudado - a.recaudado,
            )
            .slice(0, TOP_PLATOS),
          porRecaudado: [...platos]
            .sort(
              (a, b) => b.recaudado - a.recaudado || b.cantidad - a.cantidad,
            )
            .slice(0, TOP_PLATOS),
        },
        rotacionMesas: aplicaRotacion(filtros.canal)
          ? await consulta.rotacion(rango)
          : { aplica: false },
      };
    });
  }
}

/** Las consultas de un reporte, con el tenant y la zona del local. */
class ConsultaReportes {
  constructor(
    private readonly tx: PrismaClient,
    private readonly tenantId: string,
    private readonly timezone: string,
  ) {}

  /** `columna` dentro de los días del rango, en la zona del local. */
  private enRango(columna: Prisma.Sql, { desde, hasta }: RangoDias) {
    return Prisma.sql`${columna} >= (${desde}::date)::timestamp AT TIME ZONE ${this.timezone}
      AND ${columna} < (${hasta}::date + 1)::timestamp AT TIME ZONE ${this.timezone}`;
  }

  private delCanal(canales: readonly PedidoCanal[] | null) {
    return canales
      ? Prisma.sql`AND canal::text IN (${Prisma.join([...canales])})`
      : Prisma.empty;
  }

  ventasPorCanal(rango: RangoDias): Promise<FilaCanal[]> {
    return this.tx.$queryRaw<FilaCanal[]>(Prisma.sql`
      SELECT canal, SUM(monto) AS monto, SUM(pedidos)::int AS pedidos
      FROM resumen_ventas_hora
      WHERE tenant_id = ${this.tenantId}::uuid
        AND ${this.enRango(COLUMNA_HORA, rango)}
      GROUP BY canal`);
  }

  async ventasPorHora(
    rango: RangoDias,
    canales: readonly PedidoCanal[] | null,
  ): Promise<VentaPorHora[]> {
    const filas = await this.tx.$queryRaw<FilaHora[]>(Prisma.sql`
      SELECT EXTRACT(HOUR FROM hora AT TIME ZONE ${this.timezone})::int AS hora,
             SUM(monto) AS monto,
             SUM(pedidos)::int AS pedidos
      FROM resumen_ventas_hora
      WHERE tenant_id = ${this.tenantId}::uuid
        AND ${this.enRango(COLUMNA_HORA, rango)}
        ${this.delCanal(canales)}
      GROUP BY 1
      ORDER BY 1`);
    return filas.map((f) => ({
      hora: Number(f.hora),
      monto: pesos(f.monto),
      pedidos: Number(f.pedidos ?? 0),
    }));
  }

  async platos(
    rango: RangoDias,
    canales: readonly PedidoCanal[] | null,
  ): Promise<PlatoVendido[]> {
    const filas = await this.tx.$queryRaw<FilaPlato[]>(Prisma.sql`
      SELECT item_carta_id,
             (array_agg(nombre ORDER BY hora DESC))[1] AS nombre,
             SUM(cantidad)::int AS cantidad,
             SUM(recaudado) AS recaudado
      FROM resumen_platos_hora
      WHERE tenant_id = ${this.tenantId}::uuid
        AND ${this.enRango(COLUMNA_HORA, rango)}
        ${this.delCanal(canales)}
      GROUP BY item_carta_id`);
    return filas.map((f) => ({
      itemCartaId: f.item_carta_id,
      nombre: f.nombre,
      cantidad: Number(f.cantidad),
      recaudado: pesos(f.recaudado),
    }));
  }

  /** Sesiones de mesa cerradas en el período (D3). */
  async rotacion(rango: RangoDias): Promise<RotacionMesas> {
    const [fila] = await this.tx.$queryRaw<FilaRotacion[]>(Prisma.sql`
      SELECT COUNT(*)::int AS sesiones,
             AVG(EXTRACT(EPOCH FROM cerrada_en - abierta_en)) / 60 AS minutos
      FROM sesion_mesa
      WHERE tenant_id = ${this.tenantId}::uuid
        AND ${this.enRango(COLUMNA_CERRADA_EN, rango)}`);
    const mesas = await this.tx.mesa.count({
      where: { tenantId: this.tenantId, esVirtual: false },
    });
    const sesiones = Number(fila?.sesiones ?? 0);
    return {
      aplica: true,
      sesiones,
      mesas,
      rotacion: mesas > 0 ? unDecimal(sesiones / mesas) : 0,
      ocupacionPromedioMin: Math.round(Number(fila?.minutos ?? 0)),
    };
  }
}
