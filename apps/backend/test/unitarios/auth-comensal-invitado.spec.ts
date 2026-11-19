import { InternalServerErrorException } from '@nestjs/common';
import { AuthComensalService } from '../../src/auth-comensal/auth-comensal.service';
import {
  DURACION_TOKEN_INVITADO_S,
  TokenInvitado,
} from '../../src/auth-comensal/token-invitado';

// HU-052: /auth/comensal entrega el token de invitado que firma la API, con
// el canal por el que entró el comensal, sin ir a Keycloak. Desde BL-581 es
// el único emisor (antes se elegía con COMENSAL_TOKEN_EMISOR; TC-U-611 y 614
// probaban esa elección y se retiraron). Las validaciones de cada canal
// (404, 410, suspensión) se prueban en auth-comensal.service.spec.ts.

const CLAVE = 'clave-de-prueba-del-token-de-invitado-0001';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const SESION = '99999999-9999-4999-8999-999999999999';
const PEDIDO_ID = '55555555-5555-4555-8555-555555555555';

describe('AuthComensalService: token de invitado (HU-052)', () => {
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

  /** El servicio lee la clave al crearse: se crea por test. */
  const crearServicio = (env: NodeJS.ProcessEnv) => {
    process.env = {
      ...envOriginal,
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

  it('[TC-U-612] los tres endpoints firman el token de invitado con su canal, sin ir a Keycloak, y con el mismo contrato', async () => {
    const service = crearServicio({ COMENSAL_TOKEN_CLAVE: CLAVE });
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

  it('[TC-U-613] sin COMENSAL_TOKEN_CLAVE no emite nada (500) y tampoco va a Keycloak', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = crearServicio({});

    await expect(
      service.emitirToken(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow(InternalServerErrorException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
