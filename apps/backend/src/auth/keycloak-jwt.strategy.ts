import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';

export interface AuthenticatedUser {
  sub: string; // ID de usuario en Keycloak (mapea a Usuario.keycloak_id)
  tenantId: string; // claim custom "tenant_id" (ver protocolMapper del realm)
  roles: string[]; // realm_access.roles: ADMIN | MOZO | COCINA | COMENSAL
}

// Derivadas de KEYCLOAK_URL + KEYCLOAK_REALM (ya existen en el .env real del
// equipo, [MONOREPO] Paso 8) — evitamos agregar KEYCLOAK_ISSUER_URL /
// KEYCLOAK_JWKS_URI como variables nuevas y redundantes.
const KEYCLOAK_URL = process.env.KEYCLOAK_URL!;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM!;
const ISSUER_URL = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
const JWKS_URI = `${ISSUER_URL}/protocol/openid-connect/certs`;

@Injectable()
export class KeycloakJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
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
    });
  }

  async validate(payload: any): Promise<AuthenticatedUser> {
    const tenantId = payload.tenant_id;
    if (!tenantId) {
      // Denegación por defecto (RD.07): un token sin tenant_id no es válido,
      // nunca se asume alcance global.
      throw new UnauthorizedException('Token sin tenant_id asociado');
    }

    return {
      sub: payload.sub,
      tenantId,
      roles: payload.realm_access?.roles ?? [],
    };
  }
}
