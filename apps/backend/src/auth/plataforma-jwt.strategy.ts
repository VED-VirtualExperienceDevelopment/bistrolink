import { ForbiddenException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { opcionesJwtKeycloak } from './keycloak-jwt.strategy';
import { ROL_PLATAFORMA } from './rol-plataforma';

/** Usuario autenticado en los endpoints de plataforma (sin tenant). */
export interface UsuarioPlataforma {
  sub: string; // ID de usuario en Keycloak: es el actor del registro de auditoría
  roles: string[];
}

/**
 * BL-163 (HU-027): autenticación de los endpoints /plataforma/*. Se usa con
 * AuthGuard('jwt-plataforma'), nunca con el AuthGuard('jwt') de los
 * endpoints de tenant.
 *
 * Mismo control de firma, emisor y vencimiento que KeycloakJwtStrategy. Lo
 * que cambia es qué token acepta:
 * - Tiene que traer el rol PLATAFORMA. Un token válido de ADMIN, MOZO,
 *   COCINA o COMENSAL recibe 403 (está autenticado, pero no autorizado).
 * - No puede traer tenant_id: un usuario de plataforma no pertenece a
 *   ningún establecimiento. Si lo trae, es un error de configuración y se
 *   rechaza en lugar de adivinar cuál de los dos roles vale.
 *
 * La otra mitad de la regla está en KeycloakJwtStrategy: rechaza cualquier
 * token con rol PLATAFORMA, así este token no habilita ningún endpoint de
 * tenant (RD.07).
 */
@Injectable()
export class PlataformaJwtStrategy extends PassportStrategy(
  Strategy,
  'jwt-plataforma',
) {
  constructor() {
    super(opcionesJwtKeycloak());
  }

  async validate(payload: any): Promise<UsuarioPlataforma> {
    const roles: string[] = payload.realm_access?.roles ?? [];

    if (!roles.includes(ROL_PLATAFORMA)) {
      throw new ForbiddenException(`Rol requerido: ${ROL_PLATAFORMA}`);
    }
    if (payload.tenant_id) {
      throw new ForbiddenException(
        'Un usuario de plataforma no puede pertenecer a un establecimiento',
      );
    }

    return { sub: payload.sub, roles };
  }
}
