import { InternalServerErrorException } from '@nestjs/common';
import { AuthComensalService } from '../../src/auth-comensal/auth-comensal.service';
import {
  DURACION_TOKEN_INVITADO_S,
  emisorTokenComensalDesdeEntorno,
  TokenInvitado,
} from '../../src/auth-comensal/token-invitado';

// HU-052 (BL-579): quién emite el token del comensal en /auth/comensal.
// Con `keycloak` (por defecto) no cambia nada; con `api` la API firma el
// token de invitado con el canal por el que entró el comensal y no va a
// Keycloak. Las validaciones de cada canal (404, 410, suspensión) son las
// de siempre y se prueban en auth-comensal.service.spec.ts.

const CLAVE = 'clave-de-prueba-del-token-de-invitado-0001';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const SESION = '99999999-9999-4999-8999-999999999999';
const PEDIDO_ID = '55555555-5555-4555-8555-555555555555';

describe('AuthComensalService: emisor del token (HU-052, BL-579)', () => {
  const envOriginal = process.env;
  let fetchMock: jest.Mock;

  const mocks = () => ({
    tenantPrisma: {
      runInTenantContext: jest.fn().mockResolvedValue({ id: RESTAURANTE_ID }),
    },
    qrMesaAcceso: {
      resolver: jest.fn().mockResolvedValue({
        tenantId: TENANT_ID,
        mesaId: MESA_ID,
        restauranteId: RESTAURANTE_ID,
        numero: 4,
        sesionId: SESION,
      }),
    },
    tenantEstado: { asegurarActivo: jest.fn().mockResolvedValue(undefined) },
    linkPago: {
      resolver: jest.fn().mockResolvedValue({
        tenantId: TENANT_ID,
        restauranteId: RESTAURANTE_ID,
        pedidoId: PEDIDO_ID,
      }),
    },
  });

  /** El servicio lee el emisor y la clave al crearse: se crea por test. */
  const crearServicio = (env: NodeJS.ProcessEnv) => {
    process.env = {
      ...envOriginal,
      KEYCLOAK_CLIENT_SECRET: 'secreto-de-prueba',
      KEYCLOAK_COMENSAL_PASSWORD: 'password-de-prueba',
      COMENSAL_TOKEN_EMISOR: undefined,
      COMENSAL_TOKEN_CLAVE: undefined,
      COMENSAL_TOKEN_CLAVE_ANTERIOR: undefined,
      ...env,
    };
    const m = mocks();
    return new AuthComensalService(
      m.tenantPrisma as any,
      m.qrMesaAcceso as any,
      m.tenantEstado as any,
      m.linkPago as any,
    );
  };

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'jwt-de-keycloak', expires_in: 3600 }),
    });
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    process.env = envOriginal;
    jest.restoreAllMocks();
  });

  it.each([
    ['sin COMENSAL_TOKEN_EMISOR', {}],
    [
      'con COMENSAL_TOKEN_EMISOR=keycloak',
      { COMENSAL_TOKEN_EMISOR: 'keycloak' },
    ],
    [
      'con keycloak aunque haya clave',
      { COMENSAL_TOKEN_EMISOR: 'keycloak', COMENSAL_TOKEN_CLAVE: CLAVE },
    ],
  ])(
    '[TC-U-611] %s, los tres endpoints siguen pidiendo el token a Keycloak',
    async (_caso, env) => {
      const service = crearServicio(env);

      const respuestas = [
        await service.emitirToken(TENANT_ID, RESTAURANTE_ID),
        await service.emitirTokenPorQr('token-del-qr', SESION),
        await service.emitirTokenPorLink('token-del-link'),
      ];

      expect(fetchMock).toHaveBeenCalledTimes(3);
      for (const respuesta of respuestas) {
        expect(respuesta).toEqual({
          accessToken: 'jwt-de-keycloak',
          expiresIn: 3600,
        });
      }
    },
  );

  it('[TC-U-612] con api, los tres endpoints firman el token de invitado con su canal, sin ir a Keycloak, y con el mismo contrato', async () => {
    const service = crearServicio({
      COMENSAL_TOKEN_EMISOR: 'api',
      COMENSAL_TOKEN_CLAVE: CLAVE,
    });
    const verificador = new TokenInvitado({ claveActual: CLAVE });

    const retiro = await service.emitirToken(TENANT_ID, RESTAURANTE_ID);
    const mesa = await service.emitirTokenPorQr('token-del-qr', SESION);
    const link = await service.emitirTokenPorLink('token-del-link');

    expect(fetchMock).not.toHaveBeenCalled();
    for (const respuesta of [retiro, mesa, link]) {
      expect(Object.keys(respuesta).sort()).toEqual([
        'accessToken',
        'expiresIn',
      ]);
      expect(respuesta.expiresIn).toBe(DURACION_TOKEN_INVITADO_S);
    }

    expect(verificador.verificar(retiro.accessToken)).toMatchObject({
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      roles: ['COMENSAL'],
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_ID },
    });
    expect(verificador.verificar(mesa.accessToken)).toMatchObject({
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      canal: { tipo: 'mesa', mesaId: MESA_ID, sesionId: SESION },
    });
    expect(verificador.verificar(link.accessToken)).toMatchObject({
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      canal: { tipo: 'link', pedidoId: PEDIDO_ID },
    });
  });

  it('[TC-U-613] con api y sin COMENSAL_TOKEN_CLAVE no emite nada (500) y tampoco va a Keycloak', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = crearServicio({ COMENSAL_TOKEN_EMISOR: 'api' });

    await expect(
      service.emitirToken(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow(InternalServerErrorException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[TC-U-614] COMENSAL_TOKEN_EMISOR: vacío es keycloak, acepta mayúsculas y espacios, y un valor desconocido no arranca', () => {
    expect(emisorTokenComensalDesdeEntorno({})).toBe('keycloak');
    expect(
      emisorTokenComensalDesdeEntorno({ COMENSAL_TOKEN_EMISOR: '  ' }),
    ).toBe('keycloak');
    expect(
      emisorTokenComensalDesdeEntorno({ COMENSAL_TOKEN_EMISOR: ' API ' }),
    ).toBe('api');
    expect(() =>
      emisorTokenComensalDesdeEntorno({ COMENSAL_TOKEN_EMISOR: 'auth0' }),
    ).toThrow(/keycloak o api/);
    expect(() => crearServicio({ COMENSAL_TOKEN_EMISOR: 'auth0' })).toThrow(
      /keycloak o api/,
    );
  });
});
