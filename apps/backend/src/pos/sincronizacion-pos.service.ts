import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  PosSincronizacionEstado,
  PosSincronizacionTipo,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import {
  POS_ADAPTER,
  PosAdapter,
  PosRechazoError,
  VentaPos,
} from './pos.adapter';
import { ConfiguracionPos, configuracionPos } from './configuracion-pos';
import { tocaReintentarPos } from './reintentos-pos';
import { EstadoSincronizacionPos } from './dto/sincronizacion-pos.dto';

/** Filas por página del panel. */
export const TAMANO_PAGINA_POS = 20;

/** Largo máximo del motivo de error que se guarda (columna VARCHAR(200)). */
const LARGO_ERROR = 200;

/** Motivo que se le manda al POS al anular (sin datos personales). */
const MOTIVO_ANULACION = 'Pedido cancelado en BistroLink';

export interface ResumenSincronizacionPos {
  revisados: number;
  enviados: number;
  fallidos: number;
}

export function resumenSincronizacionPosVacio(): ResumenSincronizacionPos {
  return { revisados: 0, enviados: 0, fallidos: 0 };
}

/** Una fila del panel del administrador. */
export interface SincronizacionPosVista {
  id: string;
  tipo: PosSincronizacionTipo;
  estado: PosSincronizacionEstado;
  pedidoId: string;
  mesa: number | null;
  total: number;
  posRef: string | null;
  intentos: number;
  ultimoError: string | null;
  ultimoIntentoEn: string | null;
  enviadaEn: string | null;
  creadaEn: string;
}

export interface PaginaSincronizacionesPos {
  /** El local tiene activado el envío de ventas al POS. */
  habilitada: boolean;
  /** «mock», «http» o null si la API no tiene un POS configurado. */
  adaptador: string | null;
  sincronizaciones: SincronizacionPosVista[];
  pagina: number;
  hayMas: boolean;
  total: number;
}

export interface ResultadoReintentoPos {
  id: string;
  estado: PosSincronizacionEstado;
  ultimoError: string | null;
}

/** Lo que hace falta leer de una fila para mandarla. */
const SELECT_ENVIO = {
  id: true,
  tipo: true,
  estado: true,
  intentos: true,
  pedidoId: true,
  pedido: {
    select: {
      id: true,
      encoladoEn: true,
      createdAt: true,
      mesa: { select: { numero: true, esVirtual: true } },
      lineas: {
        select: {
          nombreSnapshot: true,
          cantidad: true,
          precioUnitarioSnapshot: true,
          subtotal: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      pagos: {
        where: { estado: { in: ['APROBADO', 'REEMBOLSADO'] } },
        select: { medioPago: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
      sincronizacionesPos: {
        where: { tipo: 'VENTA' },
        select: { posRef: true },
      },
    },
  },
} satisfies Prisma.SincronizacionPosSelect;

type FilaEnvio = Prisma.SincronizacionPosGetPayload<{
  select: typeof SELECT_ENVIO;
}>;

const pesos = (valor: Prisma.Decimal | number): number =>
  Math.round(Number(valor) * 100) / 100;

/** El mensaje del error, recortado para la columna y sin saltos de línea. */
function motivoDelError(error: unknown): string {
  const mensaje =
    error instanceof Error ? error.message : 'Error desconocido del POS';
  return mensaje.replace(/\s+/g, ' ').trim().slice(0, LARGO_ERROR);
}

/** La venta que se le manda al POS, sin datos personales del comensal. */
export function ventaDelPedido(pedido: FilaEnvio['pedido']): VentaPos {
  const lineas = pedido.lineas.map((l) => ({
    descripcion: l.nombreSnapshot,
    cantidad: l.cantidad,
    precioUnitario: pesos(l.precioUnitarioSnapshot),
    subtotal: pesos(l.subtotal),
  }));
  return {
    referencia: pedido.id,
    fecha: (pedido.encoladoEn ?? pedido.createdAt).toISOString(),
    moneda: 'UYU',
    total: pesos(lineas.reduce((suma, l) => suma + l.subtotal, 0)),
    medioPago: pedido.pagos[0]?.medioPago ?? 'DESCONOCIDO',
    mesa: pedido.mesa.esVirtual ? null : pedido.mesa.numero,
    lineas,
  };
}

/**
 * HU-011 (BL-488): manda al POS del local las ventas que cobró BistroLink, y
 * su anulación si el pedido se cancela (HU-024).
 *
 * - Bandeja de salida (sincronizacion_pos): la VENTA se encola en la misma
 *   transacción que confirma el pago (encolarVentaEnTx), así no se pierde
 *   aunque el POS no responda.
 * - Después del commit se manda enseguida (enviarEnSegundoPlano). Si falla,
 *   el job la reintenta, cada vez más espaciado (reintentos-pos.ts).
 * - Un fallo nunca toca el pedido: el pedido ya está cobrado y en cocina; solo
 *   la fila queda con el error (rollback de la sincronización, no del pago).
 * - Cada intento queda en el log (Pino) con el resultado, sin datos
 *   personales: el id del pedido y, si falló, el motivo.
 */
@Injectable()
export class SincronizacionPosService {
  private readonly logger = new Logger(SincronizacionPosService.name);
  private readonly configuracion: ConfiguracionPos = configuracionPos(
    process.env,
  );

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
    @Optional()
    @Inject(POS_ADAPTER)
    private readonly pos: PosAdapter | null = null,
  ) {}

  /** La API tiene un POS configurado (POS_ADAPTER distinto de «deshabilitado»). */
  configurado(): boolean {
    return this.pos !== null;
  }

  /**
   * Encola la venta de un pedido recién cobrado. Corre DENTRO de la
   * transacción que confirma el pago (PedidosService.confirmarPagoEnTx): si
   * esa transacción se revierte, tampoco queda la venta. Solo si el local
   * tiene activado el envío al POS. Idempotente (una venta por pedido).
   */
  async encolarVentaEnTx(
    tx: PrismaClient,
    tenantId: string,
    pedidoId: string,
  ): Promise<boolean> {
    if (!this.pos) return false;
    const pedido = await tx.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        restaurante: { select: { posSincronizacionHabilitada: true } },
      },
    });
    if (!pedido?.restaurante.posSincronizacionHabilitada) return false;
    await tx.sincronizacionPos.createMany({
      data: [{ tenantId, pedidoId, tipo: 'VENTA' }],
      skipDuplicates: true,
    });
    return true;
  }

  /**
   * HU-024: el pedido se canceló. Corre DENTRO de la transacción de la
   * cancelación.
   * - Si la venta ya está en el POS, encola su anulación.
   * - Si todavía no se había mandado, se descarta: no hay nada que anular.
   * - Si el pedido nunca se encoló (local sin POS), no hace nada.
   */
  async encolarAnulacionEnTx(
    tx: PrismaClient,
    tenantId: string,
    pedidoId: string,
  ): Promise<boolean> {
    const venta = await tx.sincronizacionPos.findUnique({
      where: { pedidoId_tipo: { pedidoId, tipo: 'VENTA' } },
      select: { id: true, estado: true },
    });
    if (!venta || venta.estado === 'DESCARTADA') return false;
    if (venta.estado === 'ENVIADA') {
      await tx.sincronizacionPos.createMany({
        data: [{ tenantId, pedidoId, tipo: 'ANULACION' }],
        skipDuplicates: true,
      });
      return true;
    }
    await tx.sincronizacionPos.update({
      where: { id: venta.id },
      data: { estado: 'DESCARTADA' },
    });
    return false;
  }

  /**
   * Después del commit: manda enseguida lo pendiente del pedido (la venta o
   * su anulación). En segundo plano y sin lanzar: el que cobra o cancela no
   * espera al POS. Si falla, queda para el job.
   */
  enviarEnSegundoPlano(tenantId: string, pedidoId: string): void {
    if (!this.pos) return;
    void this.enviarPendientesDelPedido(tenantId, pedidoId).catch(
      (error: unknown) =>
        this.logger.warn(
          `POS: no se pudo mandar lo pendiente del pedido ${pedidoId}: ${motivoDelError(error)}`,
        ),
    );
  }

  private async enviarPendientesDelPedido(
    tenantId: string,
    pedidoId: string,
  ): Promise<void> {
    const pendientes = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        tx.sincronizacionPos.findMany({
          where: { pedidoId, estado: 'PENDIENTE' },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        }),
    );
    // Secuencial a propósito: la anulación va después de la venta.
    for (const { id } of pendientes) {
      await /* NOSONAR */ this.enviar(tenantId, id);
    }
  }

  /**
   * Manda una fila al POS y guarda el resultado. Nunca lanza.
   * - Bien: ENVIADA, con el id del POS.
   * - POS caído: sigue PENDIENTE (lo reintenta el job) hasta agotar los
   *   intentos; ahí queda ERROR.
   * - El POS la rechazó: ERROR (reintentar no lo arregla solo).
   * Una fila ENVIADA o DESCARTADA no se vuelve a mandar.
   */
  async enviar(
    tenantId: string,
    id: string,
  ): Promise<PosSincronizacionEstado | null> {
    if (!this.pos) return null;
    const fila = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.sincronizacionPos.findUnique({ where: { id }, select: SELECT_ENVIO }),
    );
    if (!fila) return null;
    if (fila.estado === 'ENVIADA' || fila.estado === 'DESCARTADA') {
      return fila.estado;
    }

    const inicio = Date.now();
    try {
      const posRef = await this.mandar(this.pos, fila);
      await this.registrarEnvio(tenantId, fila, posRef);
      this.logger.log({
        message: `POS: ${fila.tipo === 'VENTA' ? 'venta' : 'anulación'} del pedido ${fila.pedidoId} enviada (${Date.now() - inicio} ms)`,
        pedidoId: fila.pedidoId,
        tipo: fila.tipo,
        resultado: 'ENVIADA',
        adaptador: this.pos.nombre,
        ms: Date.now() - inicio,
      });
      return 'ENVIADA';
    } catch (error) {
      const intentos = fila.intentos + 1;
      const estado: PosSincronizacionEstado =
        error instanceof PosRechazoError ||
        intentos >= this.configuracion.maxIntentos
          ? 'ERROR'
          : 'PENDIENTE';
      const motivo = motivoDelError(error);
      await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
        tx.sincronizacionPos.updateMany({
          where: { id, estado: { in: ['PENDIENTE', 'ERROR'] } },
          data: {
            estado,
            intentos,
            ultimoIntentoEn: new Date(),
            ultimoError: motivo,
          },
        }),
      );
      this.logger.warn({
        message: `POS: no se pudo mandar la ${fila.tipo === 'VENTA' ? 'venta' : 'anulación'} del pedido ${fila.pedidoId} (intento ${intentos}): ${motivo}`,
        pedidoId: fila.pedidoId,
        tipo: fila.tipo,
        resultado: estado,
        adaptador: this.pos.nombre,
        intentos,
      });
      return estado;
    }
  }

  /** Llama al POS. Devuelve el id de la venta en el POS (o null al anular). */
  private async mandar(
    pos: PosAdapter,
    fila: FilaEnvio,
  ): Promise<string | null> {
    if (fila.tipo === 'VENTA') {
      return (await pos.registrarVenta(ventaDelPedido(fila.pedido))).idPos;
    }
    const idPos = fila.pedido.sincronizacionesPos[0]?.posRef;
    if (!idPos) {
      throw new PosRechazoError('La venta de este pedido no está en el POS');
    }
    await pos.anularVenta(idPos, MOTIVO_ANULACION);
    return null;
  }

  /**
   * Guarda el envío. Si mientras se mandaba la venta el pedido se canceló
   * (la venta quedó DESCARTADA), la venta igual llegó al POS: se marca
   * ENVIADA y se encola su anulación, para que el POS no quede con una venta
   * que no existió.
   */
  private async registrarEnvio(
    tenantId: string,
    fila: FilaEnvio,
    posRef: string | null,
  ): Promise<void> {
    await this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const datos = {
        estado: 'ENVIADA' as const,
        intentos: fila.intentos + 1,
        ultimoIntentoEn: new Date(),
        ultimoError: null,
        enviadaEn: new Date(),
        ...(posRef ? { posRef } : {}),
      };
      const { count } = await tx.sincronizacionPos.updateMany({
        where: { id: fila.id, estado: { in: ['PENDIENTE', 'ERROR'] } },
        data: datos,
      });
      if (count > 0 || fila.tipo !== 'VENTA') return;
      // count 0: otro envío ya la marcó ENVIADA, o el pedido se canceló.
      const actual = await tx.sincronizacionPos.findUnique({
        where: { id: fila.id },
        select: { estado: true },
      });
      if (actual?.estado !== 'DESCARTADA') return;
      await tx.sincronizacionPos.update({
        where: { id: fila.id },
        data: datos,
      });
      await tx.sincronizacionPos.createMany({
        data: [{ tenantId, pedidoId: fila.pedidoId, tipo: 'ANULACION' }],
        skipDuplicates: true,
      });
    });
  }

  /**
   * El job: manda lo PENDIENTE del establecimiento al que le toca un
   * intento, hasta `lote` por corrida, de lo más viejo a lo más nuevo.
   */
  async sincronizarTenant(
    tenantId: string,
    configuracion: Pick<ConfiguracionPos, 'lote'>,
    ahora: Date = new Date(),
  ): Promise<ResumenSincronizacionPos> {
    if (!this.pos) return resumenSincronizacionPosVacio();
    const candidatos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        tx.sincronizacionPos.findMany({
          where: { estado: 'PENDIENTE' },
          select: {
            id: true,
            createdAt: true,
            intentos: true,
            ultimoIntentoEn: true,
          },
          orderBy: { createdAt: 'asc' },
          take: configuracion.lote * 5,
        }),
    );
    const aEnviar = candidatos
      .filter((c) => tocaReintentarPos(c, ahora))
      .slice(0, configuracion.lote);

    let enviados = 0;
    // Secuencial a propósito: sin ráfagas al POS ni varias conexiones.
    for (const { id } of aEnviar) {
      if ((await /* NOSONAR */ this.enviar(tenantId, id)) === 'ENVIADA') {
        enviados++;
      }
    }
    return {
      revisados: aEnviar.length,
      enviados,
      fallidos: aEnviar.length - enviados,
    };
  }

  /** Panel del administrador: las sincronizaciones, de la más nueva a la más vieja. */
  async listar(
    tenantId: string,
    filtros: { pagina?: number; estado?: EstadoSincronizacionPos },
  ): Promise<PaginaSincronizacionesPos> {
    const pagina = filtros.pagina ?? 1;
    const where: Prisma.SincronizacionPosWhereInput = filtros.estado
      ? { estado: filtros.estado }
      : {};
    const { filas, total, restaurante } =
      await this.tenantPrisma.runInTenantContext(tenantId, async (tx) => ({
        filas: await tx.sincronizacionPos.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (pagina - 1) * TAMANO_PAGINA_POS,
          take: TAMANO_PAGINA_POS,
          select: {
            id: true,
            tipo: true,
            estado: true,
            pedidoId: true,
            posRef: true,
            intentos: true,
            ultimoError: true,
            ultimoIntentoEn: true,
            enviadaEn: true,
            createdAt: true,
            pedido: {
              select: {
                mesa: { select: { numero: true, esVirtual: true } },
                lineas: { select: { subtotal: true } },
              },
            },
          },
        }),
        total: await tx.sincronizacionPos.count({ where }),
        restaurante: await tx.restaurante.findUnique({
          where: { tenantId },
          select: { posSincronizacionHabilitada: true },
        }),
      }));

    return {
      habilitada: restaurante?.posSincronizacionHabilitada ?? false,
      adaptador: this.pos?.nombre ?? null,
      sincronizaciones: filas.map((f) => ({
        id: f.id,
        tipo: f.tipo,
        estado: f.estado,
        pedidoId: f.pedidoId,
        mesa: f.pedido.mesa.esVirtual ? null : f.pedido.mesa.numero,
        total: pesos(
          f.pedido.lineas.reduce((suma, l) => suma + Number(l.subtotal), 0),
        ),
        posRef: f.posRef,
        intentos: f.intentos,
        ultimoError: f.ultimoError,
        ultimoIntentoEn: f.ultimoIntentoEn?.toISOString() ?? null,
        enviadaEn: f.enviadaEn?.toISOString() ?? null,
        creadaEn: f.createdAt.toISOString(),
      })),
      pagina,
      hayMas: pagina * TAMANO_PAGINA_POS < total,
      total,
    };
  }

  /**
   * «Reintentar» del panel: vuelve a mandar una fila PENDIENTE o con ERROR,
   * ahora. Los intentos vuelven a cero, así el job la sigue reintentando si
   * el POS sigue caído.
   */
  async reintentar(
    tenantId: string,
    id: string,
  ): Promise<ResultadoReintentoPos> {
    if (!this.pos) {
      throw new ConflictException(
        'La API no tiene un POS configurado (POS_ADAPTER)',
      );
    }
    const fila = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.sincronizacionPos.findUnique({
        where: { id },
        select: { estado: true },
      }),
    );
    if (!fila) throw new NotFoundException('No existe esa sincronización');
    if (fila.estado === 'ENVIADA' || fila.estado === 'DESCARTADA') {
      throw new ConflictException(
        fila.estado === 'ENVIADA'
          ? 'Ya está en el POS'
          : 'El pedido se canceló antes de mandarse: no hay nada que reintentar',
      );
    }
    await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.sincronizacionPos.update({
        where: { id },
        data: { estado: 'PENDIENTE', intentos: 0 },
      }),
    );
    await this.enviar(tenantId, id);
    const final = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.sincronizacionPos.findUniqueOrThrow({
        where: { id },
        select: { estado: true, ultimoError: true },
      }),
    );
    return { id, estado: final.estado, ultimoError: final.ultimoError };
  }

  /**
   * Activa o desactiva el envío de ventas al POS del local. Queda en la
   * auditoría como un cambio de configuración, con antes y después. No
   * toca lo ya encolado: lo pendiente se sigue mandando.
   */
  async cambiarHabilitada(
    tenantId: string,
    actorKeycloakId: string,
    habilitada: boolean,
  ): Promise<{ habilitada: boolean }> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const actual = await tx.restaurante.findUnique({
        where: { tenantId },
        select: { posSincronizacionHabilitada: true },
      });
      if (!actual) throw new NotFoundException('No existe el establecimiento');
      if (actual.posSincronizacionHabilitada === habilitada) {
        return { habilitada };
      }
      await tx.restaurante.update({
        where: { tenantId },
        data: { posSincronizacionHabilitada: habilitada },
      });
      await this.auditLog.registrarEnTx(tx, {
        action: AuditAction.ESTABLECIMIENTO_CONFIGURACION_MODIFICADA,
        tenantId,
        actorKeycloakId,
        entidadId: tenantId,
        detalle: { campos: ['posSincronizacionHabilitada'] },
        antes: { posSincronizacionHabilitada: !habilitada },
        despues: { posSincronizacionHabilitada: habilitada },
      });
      return { habilitada };
    });
  }
}
