import { generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import {
  AUDIENCIA_TOKEN_INVITADO,
  DURACION_TOKEN_INVITADO_S,
  esTokenDeInvitado,
  ISSUER_TOKEN_INVITADO,
  kidDeClave,
  TokenInvitado,
  TokenInvitadoInvalidoError,
  tokenInvitadoDesdeEntorno,
} from '../../src/auth-comensal/token-invitado';

// HU-052 (BL-577): firma y verificación del token de invitado del comensal.

const CLAVE = 'clave-de-prueba-del-token-de-invitado-0001';
const CLAVE_NUEVA = 'clave-de-prueba-del-token-de-invitado-0002';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_A = '22222222-2222-2222-2222-222222222222';
const MESA_1 = '33333333-3333-3333-3333-333333333333';
const SESION_1 = '55555555-5555-5555-5555-555555555555';

/** Firma a mano un token con el emisor y la audiencia del invitado. */
function firmarAMano(
  payload: Record<string, unknown>,
  clave: string,
  opciones: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, clave, {
    algorithm: 'HS256',
    expiresIn: 60,
    issuer: ISSUER_TOKEN_INVITADO,
    audience: AUDIENCIA_TOKEN_INVITADO,
    subject: 'comensal-x',
    keyid: kidDeClave(clave),
    ...opciones,
  });
}

const CANAL_RETIRO = { tipo: 'retiro', restaurante_id: RESTAURANTE_A };

describe('TokenInvitado (HU-052, BL-577)', () => {
  let tokens: TokenInvitado;

  beforeEach(() => {
    tokens = new TokenInvitado({ claveActual: CLAVE });
  });

  it('[TC-U-591] emite un token de 60 min que se verifica, con el tenant, el restaurante y el canal', () => {
    const emitido = tokens.emitir({
      tenantId: TENANT_A,
      restauranteId: RESTAURANTE_A,
      canal: { tipo: 'mesa', mesaId: MESA_1, sesionId: SESION_1 },
    });

    expect(emitido.expiresIn).toBe(DURACION_TOKEN_INVITADO_S);
    const invitado = tokens.verificar(emitido.accessToken);
    expect(invitado).toEqual({
      sub: expect.any(String),
      tenantId: TENANT_A,
      restauranteId: RESTAURANTE_A,
      roles: ['COMENSAL'],
      canal: { tipo: 'mesa', mesaId: MESA_1, sesionId: SESION_1 },
    });

    const header = jwt.decode(emitido.accessToken, { complete: true })!.header;
    expect(header.alg).toBe('HS256');
    expect(header.kid).toBe(kidDeClave(CLAVE));
  });

  it('[TC-U-592] cada comensal recibe un sub y un jti propios', () => {
    const datos = {
      tenantId: TENANT_A,
      canal: { tipo: 'retiro' as const, restauranteId: RESTAURANTE_A },
    };
    const a = jwt.decode(tokens.emitir(datos).accessToken) as jwt.JwtPayload;
    const b = jwt.decode(tokens.emitir(datos).accessToken) as jwt.JwtPayload;

    expect(a.sub).not.toBe(b.sub);
    expect(a.jti).not.toBe(b.jti);
  });

  it('[TC-U-593] el rol no sale del token: aunque diga ADMIN, el invitado es COMENSAL', () => {
    const token = firmarAMano(
      {
        tenant_id: TENANT_A,
        canal: CANAL_RETIRO,
        roles: ['ADMIN'],
        realm_access: { roles: ['ADMIN', 'PLATAFORMA'] },
      },
      CLAVE,
    );

    expect(tokens.verificar(token).roles).toEqual(['COMENSAL']);
  });

  it.each([
    [
      'vencido',
      () =>
        firmarAMano({ tenant_id: TENANT_A, canal: CANAL_RETIRO }, CLAVE, {
          expiresIn: -60,
        }),
    ],
    [
      'con otro emisor',
      () =>
        firmarAMano({ tenant_id: TENANT_A, canal: CANAL_RETIRO }, CLAVE, {
          issuer: 'https://keycloak/realms/bistrolink',
        }),
    ],
    [
      'con otra audiencia',
      () =>
        firmarAMano({ tenant_id: TENANT_A, canal: CANAL_RETIRO }, CLAVE, {
          audience: 'account',
        }),
    ],
    ['sin tenant_id', () => firmarAMano({ canal: CANAL_RETIRO }, CLAVE)],
    ['sin canal', () => firmarAMano({ tenant_id: TENANT_A }, CLAVE)],
    [
      'con un canal incompleto',
      () =>
        firmarAMano(
          { tenant_id: TENANT_A, canal: { tipo: 'mesa', mesa_id: MESA_1 } },
          CLAVE,
        ),
    ],
    [
      'con un canal desconocido',
      () =>
        firmarAMano(
          { tenant_id: TENANT_A, canal: { tipo: 'delivery' } },
          CLAVE,
        ),
    ],
    [
      'firmado con una clave desconocida',
      () =>
        firmarAMano(
          { tenant_id: TENANT_A, canal: CANAL_RETIRO },
          'otra-clave-que-no-conoce-la-api-000000',
        ),
    ],
    [
      'sin kid',
      () =>
        jwt.sign({ tenant_id: TENANT_A, canal: CANAL_RETIRO }, CLAVE, {
          algorithm: 'HS256',
          expiresIn: 60,
          issuer: ISSUER_TOKEN_INVITADO,
          audience: AUDIENCIA_TOKEN_INVITADO,
          subject: 'x',
        }),
    ],
    ['que no es un JWT', () => 'esto-no-es-un-jwt'],
  ])('[TC-U-594] rechaza un token %s', (_caso, armar) => {
    expect(() => tokens.verificar(armar())).toThrow(TokenInvitadoInvalidoError);
  });

  it('[TC-U-595] rechaza un token con la firma alterada', () => {
    const { accessToken } = tokens.emitir({
      tenantId: TENANT_A,
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_A },
    });
    const [header, payload] = accessToken.split('.');
    const otroPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        tenant_id: '44444444-4444-4444-4444-444444444444',
      }),
    ).toString('base64url');
    const firma = accessToken.split('.')[2];

    expect(() => tokens.verificar(`${header}.${otroPayload}.${firma}`)).toThrow(
      TokenInvitadoInvalidoError,
    );
  });

  it('[TC-U-596] rechaza alg «none» y un token firmado con RS256, aunque traigan el kid correcto', () => {
    const payload = { tenant_id: TENANT_A, canal: CANAL_RETIRO };
    const sinFirma = jwt.sign(payload, '', {
      algorithm: 'none',
      issuer: ISSUER_TOKEN_INVITADO,
      audience: AUDIENCIA_TOKEN_INVITADO,
      subject: 'x',
      keyid: kidDeClave(CLAVE),
    });
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rs256 = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      issuer: ISSUER_TOKEN_INVITADO,
      audience: AUDIENCIA_TOKEN_INVITADO,
      subject: 'x',
      keyid: kidDeClave(CLAVE),
    });

    expect(() => tokens.verificar(sinFirma)).toThrow(
      TokenInvitadoInvalidoError,
    );
    expect(() => tokens.verificar(rs256)).toThrow(TokenInvitadoInvalidoError);
  });

  it('[TC-U-597] rotación: con la clave nueva, los tokens de la anterior siguen valiendo y los nuevos se firman con la nueva', () => {
    const viejo = tokens.emitir({
      tenantId: TENANT_A,
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_A },
    }).accessToken;

    const rotado = new TokenInvitado({
      claveActual: CLAVE_NUEVA,
      claveAnterior: CLAVE,
    });
    const nuevo = rotado.emitir({
      tenantId: TENANT_A,
      canal: { tipo: 'link', pedidoId: MESA_1 },
    }).accessToken;

    expect(rotado.verificar(viejo).tenantId).toBe(TENANT_A);
    expect(rotado.verificar(nuevo).canal).toEqual({
      tipo: 'link',
      pedidoId: MESA_1,
    });
    expect(jwt.decode(nuevo, { complete: true })!.header.kid).toBe(
      kidDeClave(CLAVE_NUEVA),
    );
    // Terminada la rotación (sin la anterior), el viejo ya no vale.
    const sinAnterior = new TokenInvitado({ claveActual: CLAVE_NUEVA });
    expect(() => sinAnterior.verificar(viejo)).toThrow(
      TokenInvitadoInvalidoError,
    );
  });

  it('[TC-U-598] no arranca con una clave corta, vacía o igual a la anterior', () => {
    expect(() => new TokenInvitado({ claveActual: 'corta' })).toThrow(
      /32 bytes/,
    );
    expect(() => new TokenInvitado({ claveActual: '' })).toThrow(/32 bytes/);
    expect(
      () => new TokenInvitado({ claveActual: CLAVE, claveAnterior: 'corta' }),
    ).toThrow(/32 bytes/);
    expect(
      () => new TokenInvitado({ claveActual: CLAVE, claveAnterior: CLAVE }),
    ).toThrow(/distinta/);
  });

  it('[TC-U-599] el kid identifica la clave sin exponerla', () => {
    const kid = kidDeClave(CLAVE);

    expect(kid).toMatch(/^[0-9a-f]{16}$/);
    expect(kid).not.toContain(CLAVE.slice(0, 8));
    expect(kidDeClave(CLAVE_NUEVA)).not.toBe(kid);
  });
});

describe('Token de invitado: configuración y elección del verificador (HU-052, BL-578)', () => {
  it('[TC-U-600] tokenInvitadoDesdeEntorno: sin clave, null; con clave, verifica; con la anterior, acepta las dos; una clave corta no arranca', () => {
    expect(tokenInvitadoDesdeEntorno({})).toBeNull();
    expect(
      tokenInvitadoDesdeEntorno({ COMENSAL_TOKEN_CLAVE: '   ' }),
    ).toBeNull();

    const conClave = tokenInvitadoDesdeEntorno({
      COMENSAL_TOKEN_CLAVE: CLAVE,
    })!;
    const emitido = conClave.emitir({
      tenantId: TENANT_A,
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_A },
    });
    expect(conClave.verificar(emitido.accessToken).tenantId).toBe(TENANT_A);

    const rotado = tokenInvitadoDesdeEntorno({
      COMENSAL_TOKEN_CLAVE: CLAVE_NUEVA,
      COMENSAL_TOKEN_CLAVE_ANTERIOR: CLAVE,
    })!;
    expect(rotado.verificar(emitido.accessToken).tenantId).toBe(TENANT_A);

    expect(() =>
      tokenInvitadoDesdeEntorno({ COMENSAL_TOKEN_CLAVE: 'corta' }),
    ).toThrow(/32 bytes/);
  });

  it('[TC-U-601] esTokenDeInvitado mira solo el emisor; claveDelKid devuelve la clave de la actual o la anterior', () => {
    const tokens = new TokenInvitado({
      claveActual: CLAVE_NUEVA,
      claveAnterior: CLAVE,
    });
    const deLaApi = tokens.emitir({
      tenantId: TENANT_A,
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_A },
    }).accessToken;
    const deKeycloak = jwt.sign({ tenant_id: TENANT_A }, CLAVE, {
      issuer: 'http://localhost:8080/realms/bistrolink',
    });

    expect(esTokenDeInvitado(deLaApi)).toBe(true);
    expect(esTokenDeInvitado(deKeycloak)).toBe(false);
    expect(esTokenDeInvitado('basura')).toBe(false);

    expect(tokens.claveDelKid(kidDeClave(CLAVE_NUEVA))).toBe(CLAVE_NUEVA);
    expect(tokens.claveDelKid(kidDeClave(CLAVE))).toBe(CLAVE);
    expect(tokens.claveDelKid('0000000000000000')).toBeUndefined();
    expect(tokens.claveDelKid(undefined)).toBeUndefined();
  });
});
