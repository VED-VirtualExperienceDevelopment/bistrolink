import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { ROL_PLATAFORMA } from './rol-plataforma';

export interface AuthenticatedUser {
  sub: string; // ID de usuario en Keycloak (mapea a Usuario.keycloak_id)
  tenantId: string; // claim custom "tenant_id"
  restauranteId?: string; // <-- AGREGADO: claim custom "restaurante_id"
  roles: string[]; // realm_access.roles: ADMIN | MOZO | COCINA | COMENSAL
}

// Derivadas de KEYCLOAK_URL + KEYCLOAK_REALM (ya existen en el .env real del
// equipo, [MONOREPO] Paso 8) — evitamos agregar KEYCLOAK_ISSUER_URL /
// KEYCLOAK_JWKS_URI como variables nuevas y redundantes.
const KEYCLOAK_URL = process.env.KEYCLOAK_URL!;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM!;
const ISSUER_URL = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
const JWKS_URI = `${ISSUER_URL}/protocol/openid-connect/certs`;

/**
 * Validación del JWT de Keycloak (firma, emisor, vencimiento). La comparten
 * la estrategia de tenant y la de plataforma (BL-163): lo único que cambia
 * entre las dos es qué token aceptan en validate().
 */
export function opcionesJwtKeycloak(): StrategyOptionsWithoutRequest {
  return {
    jwtFromRequest: (req) => {
      const auth = req.headers['authorization'];
      if (!auth || !auth.startsWith('Bearer ')) return null;
      return auth.substring(7);
    },
    ignoreExpiration: false,
    secretOrKeyProvider: passportJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: JWKS_URI,
    }),
    issuer: ISSUER_URL,
    algorithms: ['RS256'],
  };
}

@Injectable()
export class KeycloakJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super(opcionesJwtKeycloak());
  }

  async validate(payload: any): Promise<AuthenticatedUser> {
    const roles: string[] = payload.realm_access?.roles ?? [];

    // BL-163: un token de plataforma nunca habilita un endpoint de tenant,
    // aunque por un error de configuración tuviera un tenant_id.
    if (roles.includes(ROL_PLATAFORMA)) {
      throw new UnauthorizedException(
        'Un token de plataforma no es válido en los endpoints de un establecimiento',
      );
    }

    const tenantId = payload.tenant_id;
    if (!tenantId) {
      // Denegación por defecto (RD.07): un token sin tenant_id no es válido,
      // nunca se asume alcance global.
      throw new UnauthorizedException('Token sin tenant_id asociado');
    }

    return {
      sub: payload.sub,
      tenantId,
      restauranteId: payload.restaurante_id, // <-- AGREGADO: extraemos el restaurante del token
      roles,
    };
  }
}
