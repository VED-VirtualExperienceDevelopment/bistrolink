import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';

// Mismo issuer/JWKS que KeycloakJwtStrategy (auth/keycloak-jwt.strategy.ts).
// No se agrega KEYCLOAK_ISSUER_URL/KEYCLOAK_JWKS_URI como variables nuevas
// por la misma razón que allá: ya existen KEYCLOAK_URL + KEYCLOAK_REALM.
//
// Por qué esto no es simplemente "reusar KeycloakJwtStrategy": Passport
// está atado al ciclo de vida de una request HTTP (Guard + Request), y acá
// no hay request de Nest en el handshake de Socket.io — solo el objeto
// `client.handshake`. Por eso se verifica el JWT a mano con la misma
// librería (jsonwebtoken + jwks-rsa) y exactamente la misma config
// (issuer, algorithms, claim tenant_id, realm_access.roles), para que un
// token que el REST rechaza sea rechazado también acá.
const KEYCLOAK_URL = process.env.KEYCLOAK_URL!;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM!;
const ISSUER_URL = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
const JWKS_URI = `${ISSUER_URL}/protocol/openid-connect/certs`;

export class WsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WsAuthError';
    // Necesario al extender una clase nativa como Error: sin esto,
    // "instanceof WsAuthError" puede dar false segun el target de
    // compilacion de TypeScript (ES5/ES2015), rompiendo el catch del
    // gateway que distingue este error de uno inesperado.
    Object.setPrototypeOf(this, WsAuthError.prototype);
  }
}

@Injectable()
export class WsAuthService {
  private readonly jwks = new JwksClient({
    jwksUri: JWKS_URI,
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
  });

  async verify(token: string | undefined): Promise<AuthenticatedUser> {
    if (!token) {
      throw new WsAuthError('Token no provisto en el handshake');
    }

    const decoded = jwt.decode(token, { complete: true });
    const kid = decoded?.header?.kid;
    if (!kid) {
      throw new WsAuthError('Token malformado (sin kid)');
    }

    let publicKey: string;
    try {
      const signingKey = await this.jwks.getSigningKey(kid);
      publicKey = signingKey.getPublicKey();
    } catch {
      throw new WsAuthError('No se pudo resolver la clave de firma (JWKS)');
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, publicKey, {
        issuer: ISSUER_URL,
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;
    } catch {
      throw new WsAuthError('Token inválido o expirado');
    }

    const tenantId = payload.tenant_id as string | undefined;
    if (!tenantId) {
      // RD.07: denegación por defecto ante ausencia de tenant_id.
      throw new WsAuthError('Token sin tenant_id asociado');
    }

    return {
      sub: payload.sub as string,
      tenantId,
      roles: (payload.realm_access as any)?.roles ?? [],
    };
  }
}
