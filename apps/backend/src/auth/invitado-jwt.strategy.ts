import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import * as jwt from 'jsonwebtoken';
import {
  ExtractJwt,
  Strategy,
  StrategyOptionsWithoutRequest,
} from 'passport-jwt';
import {
  ALGORITMO_TOKEN_INVITADO,
  AUDIENCIA_TOKEN_INVITADO,
  invitadoDesdePayload,
  ISSUER_TOKEN_INVITADO,
  TOLERANCIA_RELOJ_TOKEN_INVITADO_S,
  TokenInvitado,
  tokenInvitadoDesdeEntorno,
} from '../auth-comensal/token-invitado';
import {
  mensajeSuspendidoPara,
  TenantEstadoService,
} from '../tenant-estado/tenant-estado.service';
import { AuthenticatedUser } from './keycloak-jwt.strategy';

/**
 * HU-052 (BL-578): estrategia 'jwt-invitado'. Acepta solo el token de
 * invitado que firma la API (auth-comensal/token-invitado.ts): HS256, su
 * emisor y su audiencia, y una clave conocida por el `kid`. Un token de
 * Keycloak nunca pasa por acá: tiene otro emisor y se firma con RS256.
 *
 * Solo la usan los controladores que atienden al comensal, con
 * AuthGuardComensal (abajo). El resto de la API sigue con AuthGuard('jwt'),
 * así que un token de invitado ni siquiera se considera en los endpoints
 * del personal ni de la plataforma (401).
 */
export const ESTRATEGIA_INVITADO = 'jwt-invitado';

const MENSAJE_INVALIDO = 'Token de invitado inválido';

/**
 * Opciones de passport-jwt. Sin clave configurada (COMENSAL_TOKEN_CLAVE),
 * no hay ninguna clave que devolver y todo token de invitado se rechaza.
 */
export function opcionesJwtInvitado(
  tokens: TokenInvitado | null,
): StrategyOptionsWithoutRequest {
  return {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    ignoreExpiration: false,
    algorithms: [ALGORITMO_TOKEN_INVITADO],
    issuer: ISSUER_TOKEN_INVITADO,
    audience: AUDIENCIA_TOKEN_INVITADO,
    jsonWebTokenOptions: { clockTolerance: TOLERANCIA_RELOJ_TOKEN_INVITADO_S },
    // Sin red: elige la clave por el kid entre la actual y la anterior. Un
    // token de otro emisor se descarta antes de mirar el kid.
    secretOrKeyProvider: (_request, rawJwtToken, done) => {
      const decodificado = jwt.decode(rawJwtToken, { complete: true });
      const payload = decodificado?.payload;
      const esDeLaApi =
        typeof payload === 'object' &&
        payload !== null &&
        payload.iss === ISSUER_TOKEN_INVITADO;
      const clave = esDeLaApi
        ? tokens?.claveDelKid(decodificado?.header?.kid)
        : undefined;
      if (!clave) {
        done(new UnauthorizedException(MENSAJE_INVALIDO));
        return;
      }
      done(null, clave);
    },
  };
}

@Injectable()
export class InvitadoJwtStrategy extends PassportStrategy(
  Strategy,
  ESTRATEGIA_INVITADO,
) {
  constructor(private readonly tenantEstado: TenantEstadoService) {
    super(opcionesJwtInvitado(tokenInvitadoDesdeEntorno()));
  }

  /**
   * Llega con el token ya verificado por passport-jwt (firma, algoritmo,
   * emisor, audiencia y vencimiento). El rol es siempre COMENSAL.
   */
  async validate(payload: jwt.JwtPayload): Promise<AuthenticatedUser> {
    let invitado;
    try {
      invitado = invitadoDesdePayload(payload);
    } catch {
      throw new UnauthorizedException(MENSAJE_INVALIDO);
    }

    // BL-413: con el establecimiento suspendido, 403, igual que con un
    // token de Keycloak.
    await this.tenantEstado.asegurarActivo(
      invitado.tenantId,
      mensajeSuspendidoPara(invitado.roles),
    );

    return {
      sub: invitado.sub,
      tenantId: invitado.tenantId,
      restauranteId: invitado.restauranteId,
      roles: invitado.roles,
      canal: invitado.canal,
    };
  }
}

/**
 * Guard de los controladores que atienden al comensal: acepta el token de
 * invitado y, mientras convivan (hasta la sub-issue 5), el de Keycloak.
 * Prueba primero el de invitado porque no usa la red: un token de Keycloak
 * se descarta ahí al instante, sin pedir el JWKS.
 *
 * Los métodos del personal dentro de esos controladores siguen protegidos
 * por RolesGuard: un invitado es siempre COMENSAL, así que recibe 403.
 */
export const AuthGuardComensal = AuthGuard([ESTRATEGIA_INVITADO, 'jwt']);
