import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  EliminacionEstablecimientoService,
  tieneActividad,
} from '../plataforma/eliminacion-establecimiento.service';
import { SuspensionEstablecimientoService } from '../plataforma/suspension-establecimiento.service';
import {
  MOTIVO_SUSPENSION_E2E,
  PREFIJO_ESTABLECIMIENTO_E2E,
  TENANTS_DE_TESTING,
} from './datos-seed';

/** Resumen de la limpieza de establecimientos (lo que responde la API). */
export interface ResumenEstablecimientos {
  dryRun: boolean;
  /** «E2E Plataforma …» sin pedidos: borrados (base y Keycloak). */
  eliminados: number;
  /** «E2E Plataforma …» con pedidos: suspendidos (no se pueden borrar). */
  suspendidos: number;
  /** Cuentas de Keycloak que no se pudieron borrar (reintentar). */
  cuentasPendientes: number;
  /** No se pudieron limpiar (se ven en el log del backend). */
  conError: number;
}

interface EstablecimientoE2E {
  id: string;
  rut: string;
  estado: string;
}

/** Qué hacer con un establecimiento de prueba. Exportada para los tests. */
export function accionParaEstablecimiento(
  establecimiento: Pick<EstablecimientoE2E, 'estado'>,
  conActividad: boolean,
): 'eliminar' | 'suspender' | 'nada' {
  if (!conActividad) return 'eliminar';
  return establecimiento.estado === 'ACTIVO' ? 'suspender' : 'nada';
}

/**
 * BL-482 (BL-285, ADR 0011): saca los establecimientos que crearon los E2E
 * de plataforma («E2E Plataforma …»). Nunca toca los tenants de testing del
 * seed ni un establecimiento sin esa marca.
 *
 * Usa los servicios de la pantalla de plataforma, con sus reglas y su
 * auditoría:
 * - Sin pedidos: EliminacionEstablecimientoService (BL-418), que borra los
 *   datos y las cuentas de Keycloak.
 * - Con pedidos: SuspensionEstablecimientoService (BL-413). Lo que tiene
 *   historial no se borra.
 *
 * Un establecimiento que falla no corta a los demás: se cuenta en
 * `conError`.
 */
@Injectable()
export class LimpiezaEstablecimientosService {
  private readonly logger = new Logger(LimpiezaEstablecimientosService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly eliminacion: EliminacionEstablecimientoService,
    private readonly suspension: SuspensionEstablecimientoService,
  ) {}

  async limpiar(
    actorKeycloakId: string,
    dryRun: boolean,
  ): Promise<ResumenEstablecimientos> {
    const resumen: ResumenEstablecimientos = {
      dryRun,
      eliminados: 0,
      suspendidos: 0,
      cuentasPendientes: 0,
      conError: 0,
    };
    // Secuencial a propósito (Sonar S9382): un establecimiento por vez, cada
    // uno en su transacción, para no ocupar varias conexiones del pool único
    // (BL-430) ni varias llamadas a Keycloak a la vez. Uno que falla se
    // cuenta en conError sin cortar a los demás.
    for (const establecimiento of await this.buscar()) {
      try {
        const accion = accionParaEstablecimiento(
          establecimiento,
          await /* NOSONAR */ this.conActividad(establecimiento.id),
        );
        if (accion === 'nada') continue;
        if (!dryRun) {
          resumen.cuentasPendientes += await /* NOSONAR */ this.aplicar(
            accion,
            establecimiento,
            actorKeycloakId,
          );
        }
        resumen[accion === 'eliminar' ? 'eliminados' : 'suspendidos'] += 1;
      } catch (err) {
        this.logger.warn(
          `No se pudo limpiar el establecimiento de prueba ${establecimiento.id}: ${(err as Error).message}`,
        );
        resumen.conError += 1;
      }
    }
    return resumen;
  }

  /**
   * La tabla tenant no tiene RLS; runInTenantContext igual pide un tenant:
   * uno provisorio, como el listado de plataforma.
   */
  private buscar(): Promise<EstablecimientoE2E[]> {
    return this.tenantPrisma.runInTenantContext(randomUUID(), (tx) =>
      tx.tenant.findMany({
        where: {
          razonSocial: { startsWith: PREFIJO_ESTABLECIMIENTO_E2E },
          id: { notIn: [...TENANTS_DE_TESTING] },
        },
        select: { id: true, rut: true, estado: true },
      }),
    );
  }

  private conActividad(tenantId: string): Promise<boolean> {
    return this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tieneActividad(tx, tenantId),
    );
  }

  /** Aplica la acción; devuelve cuántas cuentas de Keycloak quedaron. */
  private async aplicar(
    accion: 'eliminar' | 'suspender',
    establecimiento: EstablecimientoE2E,
    actorKeycloakId: string,
  ): Promise<number> {
    const actor = { id: actorKeycloakId };
    if (accion === 'suspender') {
      await this.suspension.suspender(
        establecimiento.id,
        MOTIVO_SUSPENSION_E2E,
        actor,
      );
      return 0;
    }
    const { cuentas } = await this.eliminacion.eliminar(
      establecimiento.id,
      establecimiento.rut,
      actor,
    );
    return cuentas.pendientes?.length ?? 0;
  }
}
