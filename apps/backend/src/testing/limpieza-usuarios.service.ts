import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { PREFIJO_USUARIO_E2E } from './datos-seed';

/** Resumen del área `usuarios` (lo que responde la API). */
export interface ResumenUsuarios {
  /** Usuarios «e2e-…» sin historial: borrados en Keycloak y en la base. */
  eliminados: number;
  /** Usuarios «e2e-…» con historial: desactivados (no se pueden borrar). */
  desactivados: number;
  /** No se pudieron limpiar (por ejemplo, Keycloak no respondió). */
  conError: number;
}

interface UsuarioDePrueba {
  id: string;
  activo: boolean;
  _count: { pedidosComoMozo: number; historial: number };
}

/** Qué hacer con un usuario de prueba. Exportada para los tests. */
export function accionParaUsuario(
  usuario: UsuarioDePrueba,
): 'eliminar' | 'desactivar' | 'nada' {
  const { pedidosComoMozo, historial } = usuario._count;
  if (pedidosComoMozo + historial === 0) return 'eliminar';
  return usuario.activo ? 'desactivar' : 'nada';
}

/**
 * BL-481 (BL-285, ADR 0011): saca los usuarios que crearon los E2E
 * («e2e-…»). Ningún usuario del seed tiene ese prefijo.
 *
 * Usa UsuariosService, como la pantalla Usuarios: el borrado va en Keycloak
 * y en la base, con sus reglas (BL-382: con historial no se borra, se
 * desactiva; RF.19: nunca el último Admin) y su auditoría. Un usuario que
 * falla no corta la limpieza de los demás: se cuenta en `conError`.
 */
@Injectable()
export class LimpiezaUsuariosService {
  private readonly logger = new Logger(LimpiezaUsuariosService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly usuarios: UsuariosService,
  ) {}

  async limpiar(
    tenantId: string,
    actorKeycloakId: string,
    dryRun: boolean,
  ): Promise<ResumenUsuarios> {
    const deprueba: UsuarioDePrueba[] =
      await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
        tx.usuario.findMany({
          where: { username: { startsWith: PREFIJO_USUARIO_E2E } },
          select: {
            id: true,
            activo: true,
            _count: { select: { pedidosComoMozo: true, historial: true } },
          },
        }),
      );

    const resumen: ResumenUsuarios = {
      eliminados: 0,
      desactivados: 0,
      conError: 0,
    };
    for (const usuario of deprueba) {
      const accion = accionParaUsuario(usuario);
      if (accion === 'nada') continue;
      try {
        if (!dryRun) {
          await this.aplicar(accion, tenantId, actorKeycloakId, usuario.id);
        }
        resumen[accion === 'eliminar' ? 'eliminados' : 'desactivados'] += 1;
      } catch (err) {
        // Sin el username en el log: solo el id interno.
        this.logger.warn(
          `No se pudo limpiar el usuario de prueba ${usuario.id}: ${(err as Error).message}`,
        );
        resumen.conError += 1;
      }
    }
    return resumen;
  }

  private aplicar(
    accion: 'eliminar' | 'desactivar',
    tenantId: string,
    actorKeycloakId: string,
    usuarioId: string,
  ) {
    return accion === 'eliminar'
      ? this.usuarios.eliminar(tenantId, actorKeycloakId, usuarioId)
      : this.usuarios.desactivar(tenantId, actorKeycloakId, usuarioId);
  }
}
