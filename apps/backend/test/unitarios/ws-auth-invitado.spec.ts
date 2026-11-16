import * as jwt from 'jsonwebtoken';
import { WsAuthError, WsAuthService } from '../../src/pedidos/ws-auth.service';
import {
  AUDIENCIA_TOKEN_INVITADO,
  ISSUER_TOKEN_INVITADO,
  kidDeClave,
  TokenInvitado,
} from '../../src/auth-comensal/token-invitado';
import {
  MENSAJE_SUSPENDIDO_COMENSAL,
  TenantEstadoService,
} from '../../src/tenant-estado/tenant-estado.service';

// HU-052 (BL-578): el socket (KDS y carta en tiempo real) acepta el token de
// invitado del comensal. A diferencia de ws-auth.service.spec.ts, acá
// jsonwebtoken es el real: lo que se prueba es la firma. jwks-rsa se mockea
// para que ningún test salga a la red; el JWKS «falla» siempre, así que un
// token que no sea de invitado nunca puede pasar.
const mockGetSigningKey = jest.fn();
jest.mock('jwks-rsa', () => ({
  JwksClient: jest.fn().mockImplementation(() => ({
    getSigningKey: mockGetSigningKey,
  })),
}));

const CLAVE = 'clave-de-prueba-del-token-de-invitado-0001';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_A = '22222222-2222-2222-2222-222222222222';
const MESA_1 = '33333333-3333-3333-3333-333333333333';
const SESION_1 = '55555555-5555-5555-5555-555555555555';

describe('WsAuthService con el token de invitado (HU-052, BL-578)', () => {
  const envOriginal = process.env;
  const tenantEstado = { estaSuspendido: jest.fn() };
  const tokens = new TokenInvitado({ claveActual: CLAVE });

  const crearServicio = () =>
    new WsAuthService(tenantEstado as unknown as TenantEstadoService);

  beforeEach(() => {
    process.env = { ...envOriginal, COMENSAL_TOKEN_CLAVE: CLAVE };
    tenantEstado.estaSuspendido.mockReset().mockResolvedValue(false);
    mockGetSigningKey.mockReset().mockRejectedValue(new Error('sin JWKS'));
  });

  afterEach(() => {
    process.env = envOriginal;
  });

  it('[TC-U-606] acepta el token de invitado: COMENSAL, con el tenant y el canal, sin consultar el JWKS', async () => {
    const { accessToken } = tokens.emitir({
      tenantId: TENANT_A,
      restauranteId: RESTAURANTE_A,
      canal: { tipo: 'mesa', mesaId: MESA_1, sesionId: SESION_1 },
    });

    const usuario = await crearServicio().verify(accessToken);

    expect(usuario).toEqual({
      sub: expect.any(String),
      tenantId: TENANT_A,
      restauranteId: RESTAURANTE_A,
      roles: ['COMENSAL'],
      canal: { tipo: 'mesa', mesaId: MESA_1, sesionId: SESION_1 },
    });
    expect(mockGetSigningKey).not.toHaveBeenCalled();
  });

  it('[TC-U-607] rechaza un token de invitado sin clave configurada, con otra clave, vencido o con otra audiencia', async () => {
    const valido = tokens.emitir({
      tenantId: TENANT_A,
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_A },
    }).accessToken;
    const firmar = (clave: string, opciones: jwt.SignOptions = {}) =>
      jwt.sign(
        {
          tenant_id: TENANT_A,
          canal: { tipo: 'retiro', restaurante_id: RESTAURANTE_A },
        },
        clave,
        {
          algorithm: 'HS256',
          expiresIn: 60,
          issuer: ISSUER_TOKEN_INVITADO,
          audience: AUDIENCIA_TOKEN_INVITADO,
          subject: 'x',
          keyid: kidDeClave(clave),
          ...opciones,
        },
      );

    const servicio = crearServicio();
    for (const token of [
      firmar('otra-clave-que-no-conoce-la-api-0000000000'),
      firmar(CLAVE, { expiresIn: -60 }),
      firmar(CLAVE, { audience: 'account' }),
    ]) {
      await expect(servicio.verify(token)).rejects.toThrow(WsAuthError);
    }

    process.env = { ...envOriginal, COMENSAL_TOKEN_CLAVE: '' };
    await expect(crearServicio().verify(valido)).rejects.toThrow(WsAuthError);
  });

  it('[TC-U-608] un token que dice ser de Keycloak, firmado con la clave de la API, no pasa: se verifica contra Keycloak (RS256)', async () => {
    const falso = jwt.sign(
      { tenant_id: TENANT_A, realm_access: { roles: ['ADMIN'] } },
      CLAVE,
      {
        algorithm: 'HS256',
        expiresIn: 60,
        issuer: 'http://localhost:8080/realms/bistrolink',
        keyid: kidDeClave(CLAVE),
      },
    );

    await expect(crearServicio().verify(falso)).rejects.toThrow(WsAuthError);
    expect(mockGetSigningKey).toHaveBeenCalledWith(kidDeClave(CLAVE));
  });

  it('[TC-U-609] con el establecimiento suspendido, el token de invitado se rechaza con el mensaje del comensal', async () => {
    tenantEstado.estaSuspendido.mockResolvedValue(true);
    const { accessToken } = tokens.emitir({
      tenantId: TENANT_A,
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_A },
    });

    await expect(crearServicio().verify(accessToken)).rejects.toThrow(
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
  });
});
