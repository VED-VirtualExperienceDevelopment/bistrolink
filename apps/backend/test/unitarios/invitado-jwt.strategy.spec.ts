import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import {
  InvitadoJwtStrategy,
  opcionesJwtInvitado,
} from '../../src/auth/invitado-jwt.strategy';
import {
  ISSUER_TOKEN_INVITADO,
  kidDeClave,
  TokenInvitado,
} from '../../src/auth-comensal/token-invitado';
import {
  errorEstablecimientoSuspendido,
  MENSAJE_SUSPENDIDO_COMENSAL,
  TenantEstadoService,
} from '../../src/tenant-estado/tenant-estado.service';

// HU-052 (BL-578): estrategia HTTP 'jwt-invitado'.

const CLAVE = 'clave-de-prueba-del-token-de-invitado-0001';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_A = '22222222-2222-2222-2222-222222222222';

type Provider = (
  request: unknown,
  rawJwtToken: string,
  done: (error: unknown, clave?: string) => void,
) => void;

/** Corre el secretOrKeyProvider y devuelve la clave o el error. */
function claveQueElige(
  tokens: TokenInvitado | null,
  token: string,
): { error?: unknown; clave?: string } {
  const { secretOrKeyProvider: provider } = opcionesJwtInvitado(
    tokens,
  ) as unknown as { secretOrKeyProvider: Provider };
  let resultado: { error?: unknown; clave?: string } = {};
  provider({}, token, (error, clave) => {
    resultado = { error: error ?? undefined, clave };
  });
  return resultado;
}

describe('InvitadoJwtStrategy (HU-052, BL-578)', () => {
  const tokens = new TokenInvitado({ claveActual: CLAVE });
  const tenantEstado = { asegurarActivo: jest.fn() };

  beforeEach(() => {
    tenantEstado.asegurarActivo.mockReset().mockResolvedValue(undefined);
  });

  it('[TC-U-602] opciones: solo HS256, con el emisor y la audiencia del invitado', () => {
    const opciones = opcionesJwtInvitado(tokens);

    expect(opciones.algorithms).toEqual(['HS256']);
    expect(opciones.issuer).toBe(ISSUER_TOKEN_INVITADO);
    expect(opciones.audience).toBe('bistrolink-comensal');
    expect(opciones.ignoreExpiration).toBe(false);
  });

  it('[TC-U-603] la clave se elige por el kid solo si el token dice venir de la API; si no, no hay clave (sin pedir nada por la red)', () => {
    const deLaApi = tokens.emitir({
      tenantId: TENANT_A,
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_A },
    }).accessToken;
    // Un token que dice ser de Keycloak pero trae el kid de nuestra clave.
    const keycloakConNuestroKid = jwt.sign({ tenant_id: TENANT_A }, CLAVE, {
      issuer: 'http://localhost:8080/realms/bistrolink',
      keyid: kidDeClave(CLAVE),
    });
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const deKeycloak = jwt.sign({ tenant_id: TENANT_A }, privateKey, {
      algorithm: 'RS256',
      issuer: 'http://localhost:8080/realms/bistrolink',
      keyid: 'kid-de-keycloak',
    });
    const kidDesconocido = jwt.sign({ tenant_id: TENANT_A }, CLAVE, {
      issuer: ISSUER_TOKEN_INVITADO,
      keyid: '0000000000000000',
    });

    expect(claveQueElige(tokens, deLaApi)).toEqual({
      error: undefined,
      clave: CLAVE,
    });
    for (const token of [keycloakConNuestroKid, deKeycloak, kidDesconocido]) {
      const { error, clave } = claveQueElige(tokens, token);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(clave).toBeUndefined();
    }
    // Sin COMENSAL_TOKEN_CLAVE, ningún token de invitado tiene clave.
    expect(claveQueElige(null, deLaApi).error).toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('[TC-U-604] validate: el invitado es siempre COMENSAL, con su canal, aunque el token diga ADMIN', async () => {
    const strategy = new InvitadoJwtStrategy(
      tenantEstado as unknown as TenantEstadoService,
    );

    const usuario = await strategy.validate({
      sub: 'comensal-1',
      tenant_id: TENANT_A,
      restaurante_id: RESTAURANTE_A,
      canal: { tipo: 'retiro', restaurante_id: RESTAURANTE_A },
      realm_access: { roles: ['ADMIN'] },
      roles: ['PLATAFORMA'],
    });

    expect(usuario).toEqual({
      sub: 'comensal-1',
      tenantId: TENANT_A,
      restauranteId: RESTAURANTE_A,
      roles: ['COMENSAL'],
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_A },
    });
    expect(tenantEstado.asegurarActivo).toHaveBeenCalledWith(
      TENANT_A,
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
  });

  it('[TC-U-605] validate: claims incompletos → 401; establecimiento suspendido → 403', async () => {
    const strategy = new InvitadoJwtStrategy(
      tenantEstado as unknown as TenantEstadoService,
    );

    await expect(
      strategy.validate({ sub: 'x', canal: { tipo: 'retiro' } }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    tenantEstado.asegurarActivo.mockRejectedValue(
      errorEstablecimientoSuspendido(MENSAJE_SUSPENDIDO_COMENSAL),
    );
    await expect(
      strategy.validate({
        sub: 'x',
        tenant_id: TENANT_A,
        canal: { tipo: 'retiro', restaurante_id: RESTAURANTE_A },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
