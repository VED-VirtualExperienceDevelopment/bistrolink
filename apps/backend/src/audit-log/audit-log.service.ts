// src/audit-log/audit-log.service.ts

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaRuntimeClient } from '../prisma/prisma-runtime.client';
import { AuditAction } from './audit-action.enum';
import { contextoAuditoria } from './contexto-auditoria';

export interface AuditLogEntry {
  action: AuditAction;
  tenantId: string;
  /** sub del JWT del actor (Keycloak ID) — nunca el body del request. */
  actorKeycloakId: string;
  /**
   * Usuario afectado. Opcional desde BL-387: las acciones sobre la carta no
   * afectan a un usuario y llevan su objetivo en `detalle` (por ej. itemId).
   */
  targetUsuarioId?: string;
  detalle?: Record<string, unknown>;
  /**
   * HU-035 (BL-205): entidad afectada. Si no se indica, sale del prefijo de
   * la acción (USUARIO_ → usuario, ESTABLECIMIENTO_ → establecimiento…) y
   * el id, de targetUsuarioId.
   */
  entidad?: string;
  entidadId?: string;
  /** HU-035: valores antes y después del cambio (por ejemplo, el precio). */
  antes?: Record<string, unknown>;
  despues?: Record<string, unknown>;
}

/** Fila de registro_auditoria lista para insertar (sin el usuario). */
export interface FilaAuditoria {
  tenantId: string;
  actorKeycloakId: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  valoresAntes: Prisma.InputJsonValue | typeof Prisma.DbNull;
  valoresDespues: Prisma.InputJsonValue | typeof Prisma.DbNull;
  detalle: Prisma.InputJsonValue | typeof Prisma.DbNull;
  ip: string | null;
}

const ENTIDAD_POR_PREFIJO: ReadonlyArray<[string, string]> = [
  ['USUARIO_', 'usuario'],
  ['ESTABLECIMIENTO_', 'establecimiento'],
  ['CARTA_ITEM_', 'item_carta'],
  ['CARTA_CATEGORIA_', 'categoria_carta'], // BL-396
  ['MESA_', 'mesa'],
  ['PAGO_', 'pago'],
];

/**
 * HU-035: nunca se guardan contraseñas, secretos, tokens ni datos de
 * tarjeta, aunque un llamador los pase por error en el detalle. Se compara
 * por el nombre del campo, sin importar mayúsculas ni el idioma.
 */
const CAMPO_SENSIBLE =
  /pass|contrase|secret|token|tarjeta|card|cvv|cvc|clave|credencial/i;
const OCULTO = '[oculto]';

export function sinDatosSensibles(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(sinDatosSensibles);
  if (valor instanceof Prisma.Decimal) return valor.toFixed();
  if (valor instanceof Date) return valor.toISOString();
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([clave, v]) => [
        clave,
        CAMPO_SENSIBLE.test(clave) ? OCULTO : sinDatosSensibles(v),
      ]),
    );
  }
  return valor;
}

/**
 * Los detalles que ya existían traen el cambio como pares
 * `rolAnterior`/`rolNuevo` o `imagenKeyAnterior`/`imagenKeyNueva`. Se pasan
 * a antes/después para que se consulten igual que los cambios nuevos.
 */
export function separarAntesDespues(detalle: Record<string, unknown> = {}): {
  antes: Record<string, unknown>;
  despues: Record<string, unknown>;
  resto: Record<string, unknown>;
} {
  const antes: Record<string, unknown> = {};
  const despues: Record<string, unknown> = {};
  const resto: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(detalle)) {
    const anterior = /^(.+)Anterior$/.exec(clave);
    const nuevo = /^(.+)Nuev[oa]$/.exec(clave);
    if (anterior) antes[anterior[1]] = valor;
    else if (nuevo) despues[nuevo[1]] = valor;
    else resto[clave] = valor;
  }
  return { antes, despues, resto };
}

function entidadDeLaAccion(accion: string): string {
  return (
    ENTIDAD_POR_PREFIJO.find(([prefijo]) => accion.startsWith(prefijo))?.[1] ??
    'otra'
  );
}

function jsonONulo(
  valor: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!valor || Object.keys(valor).length === 0) return Prisma.DbNull;
  return sinDatosSensibles(valor) as Prisma.InputJsonValue;
}

export function armarFila(entry: AuditLogEntry): FilaAuditoria {
  const { antes, despues, resto } = separarAntesDespues(entry.detalle);
  return {
    tenantId: entry.tenantId,
    actorKeycloakId: entry.actorKeycloakId.slice(0, 64),
    accion: entry.action,
    entidad: entry.entidad ?? entidadDeLaAccion(entry.action),
    entidadId: (entry.entidadId ?? entry.targetUsuarioId)?.slice(0, 64) ?? null,
    valoresAntes: jsonONulo({ ...antes, ...entry.antes }),
    valoresDespues: jsonONulo({ ...despues, ...entry.despues }),
    detalle: jsonONulo(resto),
    ip: contextoAuditoria()?.ip ?? null,
  };
}

/** Lo que el registro usa de la transacción (sirve PrismaClient o tx). */
export type ClienteAuditoria = Pick<
  PrismaClient,
  'usuario' | 'registroAuditoria'
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Servicio de auditoría (HU-013, DoD [S]; HU-035, BL-205).
 *
 * Cada entrada va a dos lugares:
 *
 * 1. **El log** (contexto 'Audit'), como hasta ahora. Deliberadamente NO usa
 *    @InjectPinoLogger: usa el Logger de @nestjs/common, que ya queda
 *    enrutado a Pino (main.ts hace `app.useLogger(app.get(Logger))`), a
 *    nivel INFO. En Loki: `{app="bistrolink"} | json | context="Audit"`; en
 *    Railway (BL-273): `@context:Audit` o `@action:USUARIO_DESACTIVADO`. El
 *    campo `message` es el texto que Railway muestra en la lista.
 *
 * 2. **La tabla registro_auditoria** (BL-205), que el administrador consulta
 *    desde la app. Dos formas de escribirla:
 *    - `registrarEnTx(tx, …)`: dentro de la transacción del cambio. Si la
 *      transacción se revierte, el registro también. Es la que se usa
 *      cuando el cambio es en nuestra base (carta, mesas, cobros).
 *    - `registrar(…)`: en una transacción propia, sin esperar. Para cambios
 *      que no son de nuestra base (cuentas de Keycloak): el cambio ya se
 *      hizo y no se puede deshacer porque falle la auditoría. Si la
 *      escritura falla, queda un error en el log (y la entrada de
 *      auditoría del log igual se escribió).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger('Audit');

  // El pool único de la app (BL-430). Tipado como PrismaClient para que un
  // script pueda pasar el suyo (scripts/reprocesar-imagenes-carta.ts).
  constructor(
    @Inject(PrismaRuntimeClient) private readonly prisma: PrismaClient,
  ) {}

  registrar(entry: AuditLogEntry): void {
    const fila = this.loguear(entry);
    void this.guardarAparte(fila);
  }

  async registrarEnTx(
    tx: ClienteAuditoria,
    entry: AuditLogEntry,
  ): Promise<void> {
    const fila = this.loguear(entry);
    await this.insertar(tx, fila);
  }

  private loguear(entry: AuditLogEntry): FilaAuditoria {
    const fila = armarFila(entry);
    this.logger.log({
      message: `Auditoría: ${entry.action}`,
      audit: true,
      action: entry.action,
      tenantId: entry.tenantId,
      actorKeycloakId: entry.actorKeycloakId,
      targetUsuarioId: entry.targetUsuarioId,
      ...(sinDatosSensibles(entry.detalle ?? {}) as Record<string, unknown>),
      ...(entry.antes ? { antes: sinDatosSensibles(entry.antes) } : {}),
      ...(entry.despues ? { despues: sinDatosSensibles(entry.despues) } : {}),
      ip: fila.ip,
      timestamp: new Date().toISOString(),
    });
    return fila;
  }

  private async guardarAparte(fila: FilaAuditoria): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true)`,
          fila.tenantId,
        );
        await this.insertar(tx, fila);
      });
    } catch (error) {
      this.logger.error(
        `No se pudo guardar en registro_auditoria la acción ${fila.accion} del tenant ${fila.tenantId}: ${(error as Error).message}`,
      );
    }
  }

  private async insertar(
    tx: ClienteAuditoria,
    fila: FilaAuditoria,
  ): Promise<void> {
    // Usuario del tenant que hizo la acción, si existe (la plataforma y los
    // scripts no tienen fila en `usuario`).
    const usuario = UUID.test(fila.actorKeycloakId)
      ? await tx.usuario.findUnique({
          where: { keycloakId: fila.actorKeycloakId },
          select: { id: true },
        })
      : null;
    await tx.registroAuditoria.create({
      data: { ...fila, usuarioId: usuario?.id ?? null },
    });
  }
}
