import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  HORA_MS,
  ResumenVentasService,
  truncarHora,
} from '../reportes/resumen-ventas.service';
import {
  POS_ADAPTER,
  PosAdapter,
  PosNoDisponibleError,
  VentaDelPos,
} from './pos.adapter';
import { PosMockAdapter } from './pos-mock.adapter';
import { MedioVentaPos } from './dto/sincronizacion-pos.dto';

/** Ventas por consulta al POS. */
export const LOTE_IMPORTACION_POS = 100;

/** Consultas por corrida y establecimiento (como mucho 1000 ventas). */
const MAX_CONSULTAS = 10;

/** La primera vez se traen las ventas del último día. */
export const PRIMERA_IMPORTACION_MS = 24 * HORA_MS;

export interface ResultadoImportacionPos {
  /** Ventas que devolvió el POS (incluidas las que mandó BistroLink). */
  recibidas: number;
  /** Ventas hechas en el POS que no estaban. */
  nuevas: number;
  /** Ventas que ya estaban y cambiaron (anuladas, por ejemplo). */
  actualizadas: number;
  /** Las que mandó BistroLink: ya son pagos, no se importan. */
  omitidas: number;
}

export function resultadoImportacionVacio(): ResultadoImportacionPos {
  return { recibidas: 0, nuevas: 0, actualizadas: 0, omitidas: 0 };
}

/** Lo que muestra el panel «POS del local». */
export interface ResumenVentasDelPos {
  /** Ventas importadas que cuentan (sin las anuladas). */
  ventas: number;
  anuladas: number;
  /** Suma de las que cuentan, en pesos. */
  total: number;
  /** La venta más reciente, ISO 8601. */
  ultimaVentaEn: string | null;
}

const pesos = (valor: Prisma.Decimal | number | null): number =>
  Math.round(Number(valor ?? 0) * 100) / 100;

/**
 * HU-011 (BL-489): trae las ventas hechas directamente en el POS del local
 * y las suma al dashboard con el canal POS (sincronización en los dos
 * sentidos; el otro es BL-488).
 *
 * - Solo los establecimientos con la sincronización activada.
 * - Pide al POS lo creado o cambiado desde la última venta importada (o el
 *   último día, la primera vez). `desde` es inclusivo: lo que se repite no
 *   se duplica, porque se guarda por (tenant, id del POS).
 * - Las ventas que mandó BistroLink (con referencia) no se importan: ya son
 *   pagos y se contarían dos veces.
 * - Una venta anulada en el POS se marca y deja de contar.
 * - Después recalcula el resumen de las horas que cambiaron.
 * - Si el POS no responde, lanza PosNoDisponibleError: el job lo deja en el
 *   log y lo intenta en la próxima corrida. No se pierde nada, porque se
 *   sigue desde la última venta guardada.
 */
@Injectable()
export class ImportacionVentasPosService {
  private readonly logger = new Logger(ImportacionVentasPosService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly resumenVentas: ResumenVentasService,
    @Optional()
    @Inject(POS_ADAPTER)
    private readonly pos: PosAdapter | null = null,
  ) {}

  async importarTenant(
    tenantId: string,
    ahora: Date = new Date(),
  ): Promise<ResultadoImportacionPos> {
    const resultado = resultadoImportacionVacio();
    if (!this.pos || !(await this.habilitada(tenantId))) return resultado;

    let desde = await this.desde(tenantId, ahora);
    const horas: Date[] = [];
    for (let consulta = 0; consulta < MAX_CONSULTAS; consulta++) {
      const ventas = await /* NOSONAR */ this.pos.listarVentas({
        establecimiento: tenantId,
        desde,
        limite: LOTE_IMPORTACION_POS,
      });
      resultado.recibidas += ventas.length;
      const propias = ventas.filter((v) => v.referencia === null);
      resultado.omitidas += ventas.length - propias.length;
      const cambios = await /* NOSONAR */ this.guardar(tenantId, propias);
      resultado.nuevas += cambios.nuevas;
      resultado.actualizadas += cambios.actualizadas;
      horas.push(...cambios.horas);

      const ultima = ventas.at(-1);
      // Menos de un lote: no hay más. Si la última es igual a `desde`, son
      // todas del mismo instante y no hay forma de avanzar.
      if (ventas.length < LOTE_IMPORTACION_POS || !ultima) break;
      const siguiente = new Date(ultima.actualizadaEn);
      if (siguiente.getTime() <= desde.getTime()) break;
      desde = siguiente;
    }

    if (horas.length > 0) {
      const tiempos = horas.map((h) => truncarHora(h).getTime());
      await this.resumenVentas.recalcularVentana(tenantId, {
        desde: new Date(Math.min(...tiempos)),
        hasta: new Date(Math.max(...tiempos) + HORA_MS),
      });
    }
    if (resultado.nuevas > 0 || resultado.actualizadas > 0) {
      this.logger.log({
        message: `POS: ${resultado.nuevas} ventas nuevas y ${resultado.actualizadas} actualizadas (tenant ${tenantId})`,
        tenantId,
        ...resultado,
      });
    }
    return resultado;
  }

  /** Importación manual desde el panel: 409 si no hay POS o está apagada. */
  async importarAhora(tenantId: string): Promise<ResultadoImportacionPos> {
    if (!this.pos) {
      throw new ConflictException('La API no tiene un POS configurado');
    }
    if (!(await this.habilitada(tenantId))) {
      throw new ConflictException(
        'Activá la sincronización con el POS para traer las ventas',
      );
    }
    try {
      return await this.importarTenant(tenantId);
    } catch (error) {
      if (error instanceof PosNoDisponibleError) {
        throw new ConflictException(
          `No se pudieron traer las ventas: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Demo con el POS de prueba: registra una venta como si se hubiera hecho
   * en el mostrador y la trae enseguida. 409 con otro adaptador.
   */
  async simularVenta(
    tenantId: string,
    venta: { total: number; medioPago: MedioVentaPos },
  ): Promise<ResultadoImportacionPos & { idPos: string }> {
    if (!(this.pos instanceof PosMockAdapter)) {
      throw new ConflictException(
        'Solo se pueden simular ventas con el POS de prueba',
      );
    }
    const { idPos } = this.pos.simularVentaPropia(tenantId, venta);
    return { idPos, ...(await this.importarAhora(tenantId)) };
  }

  async resumen(tenantId: string): Promise<ResumenVentasDelPos> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const [validas, anuladas, ultima] = await Promise.all([
        tx.ventaPosImportada.aggregate({
          where: { tenantId, anulada: false },
          _count: { _all: true },
          _sum: { total: true },
        }),
        tx.ventaPosImportada.count({ where: { tenantId, anulada: true } }),
        tx.ventaPosImportada.findFirst({
          where: { tenantId },
          orderBy: { vendidaEn: 'desc' },
          select: { vendidaEn: true },
        }),
      ]);
      return {
        ventas: validas._count._all,
        anuladas,
        total: pesos(validas._sum.total),
        ultimaVentaEn: ultima?.vendidaEn.toISOString() ?? null,
      };
    });
  }

  private async habilitada(tenantId: string): Promise<boolean> {
    const restaurante = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        tx.restaurante.findUnique({
          where: { tenantId },
          select: { posSincronizacionHabilitada: true },
        }),
    );
    return restaurante?.posSincronizacionHabilitada ?? false;
  }

  /** Desde el último cambio importado, o el último día la primera vez. */
  private async desde(tenantId: string, ahora: Date): Promise<Date> {
    const ultima = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.ventaPosImportada.findFirst({
        where: { tenantId },
        orderBy: { actualizadaEnPos: 'desc' },
        select: { actualizadaEnPos: true },
      }),
    );
    return (
      ultima?.actualizadaEnPos ??
      new Date(ahora.getTime() - PRIMERA_IMPORTACION_MS)
    );
  }

  /**
   * Guarda las ventas nuevas y actualiza las que cambiaron. Devuelve las
   * horas (de la venta) que hay que recalcular en el resumen.
   */
  private async guardar(
    tenantId: string,
    ventas: VentaDelPos[],
  ): Promise<{ nuevas: number; actualizadas: number; horas: Date[] }> {
    const cambios = { nuevas: 0, actualizadas: 0, horas: [] as Date[] };
    if (ventas.length === 0) return cambios;
    await this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const existentes = await tx.ventaPosImportada.findMany({
        where: { tenantId, idPos: { in: ventas.map((v) => v.idPos) } },
        select: {
          idPos: true,
          vendidaEn: true,
          total: true,
          medioPago: true,
          anulada: true,
        },
      });
      const porId = new Map(existentes.map((e) => [e.idPos, e]));
      for (const venta of ventas) {
        const datos = {
          vendidaEn: new Date(venta.fecha),
          total: new Prisma.Decimal(venta.total.toFixed(2)),
          medioPago: venta.medioPago.slice(0, 30),
          anulada: venta.anulada,
          actualizadaEnPos: new Date(venta.actualizadaEn),
        };
        const existente = porId.get(venta.idPos);
        if (!existente) {
          await /* NOSONAR */ tx.ventaPosImportada.create({
            data: { tenantId, idPos: venta.idPos, ...datos },
          });
          cambios.nuevas++;
          cambios.horas.push(datos.vendidaEn);
          continue;
        }
        const cambio =
          existente.anulada !== datos.anulada ||
          !existente.total.equals(datos.total) ||
          existente.medioPago !== datos.medioPago ||
          existente.vendidaEn.getTime() !== datos.vendidaEn.getTime();
        // Igual se guarda actualizadaEnPos: la próxima consulta sigue de ahí.
        await /* NOSONAR */ tx.ventaPosImportada.update({
          where: { tenantId_idPos: { tenantId, idPos: venta.idPos } },
          data: datos,
        });
        if (cambio) {
          cambios.actualizadas++;
          cambios.horas.push(existente.vendidaEn, datos.vendidaEn);
        }
      }
    });
    return cambios;
  }
}
