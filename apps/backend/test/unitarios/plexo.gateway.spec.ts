import { BadGatewayException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlexoGateway } from '../../src/pagos/gateways/plexo.gateway';
import { SolicitudCobro } from '../../src/pagos/gateways/pago-gateway.interface';
import {
  armarReferenciaExterna,
  leerReferenciaExterna,
} from '../../src/pagos/webhooks/referencia-externa';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';

function solicitud(overrides: Partial<SolicitudCobro> = {}): SolicitudCobro {
  return {
    monto: new Prisma.Decimal('590'),
    idempotencyKey: 'pago-001',
    pedidoId: PEDIDO_ID,
    tenantId: TENANT_ID,
    datosPasarela: {},
    ...overrides,
  };
}

function respuesta(status: number, cuerpo: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  } as Response;
}

// Forma real de una sesión creada, según lo verificado contra el sandbox.
function sesionCreada(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ses-1',
    actions: [
      {
        rel: 'self',
        method: 'EMBEDDED',
        href: 'https://checkout.testing.plexo.com.uy/e/ses-1?t=abc',
      },
    ],
    ...overrides,
  };
}

describe('PlexoGateway', () => {
  let fetchMock: jest.SpyInstance;
  const envOriginal = { ...process.env };

  beforeEach(() => {
    process.env.PLEXO_CLIENT_ID = '1378';
    process.env.PLEXO_API_KEY = 'una-api-key';
    process.env.PLEXO_MERCHANT_ID = '15022';
    process.env.BACKEND_URL = 'https://bistrolink-api-staging.up.railway.app';
    process.env.FRONTEND_URL = 'https://bistrolink-web-staging.up.railway.app';
    jest.spyOn(Logger, 'log').mockImplementation();
    jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    process.env = { ...envOriginal };
    jest.restoreAllMocks();
  });

  describe('cobrar: crea la sesión y devuelve la acción para el iframe', () => {
    it('nunca es un resultado final: siempre pendiente, con la URL del checkout embebido', async () => {
      fetchMock.mockResolvedValue(respuesta(200, sesionCreada()));

      const resultado = await new PlexoGateway().cobrar(solicitud());

      expect(resultado).toEqual({
        aprobado: false,
        pendiente: true,
        pasarelaReferencia: 'ses-1',
        accionRequerida: {
          tipo: 'iframe',
          url: 'https://checkout.testing.plexo.com.uy/e/ses-1?t=abc',
        },
      });
    });

    it('arma la sesión con el monto, el merchantId y la referencia tenant+pedido', async () => {
      fetchMock.mockResolvedValue(respuesta(200, sesionCreada()));

      await new PlexoGateway().cobrar(solicitud());

      const [url, opciones] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.testing.plexo.com.uy/v1/sessions');
      expect(opciones.method).toBe('POST');
      // Authorization: Basic base64(clientId:apiKey)
      expect(opciones.headers.Authorization).toBe(
        `Basic ${Buffer.from('1378:una-api-key').toString('base64')}`,
      );
      const cuerpo = JSON.parse(opciones.body);
      expect(cuerpo.merchantId).toBe(15022);
      expect(cuerpo.type).toBe('checkout');
      expect(cuerpo.paymentRequest.amount).toEqual({
        total: 590,
        currency: 'UYU',
      });
      expect(leerReferenciaExterna(cuerpo.referenceId)).toEqual({
        tenantId: TENANT_ID,
        pedidoId: PEDIDO_ID,
      });
    });

    it('BL-78: la referencia de la sesión es la misma que va a leer el webhook', async () => {
      fetchMock.mockResolvedValue(respuesta(200, sesionCreada()));

      await new PlexoGateway().cobrar(solicitud());

      const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(cuerpo.referenceId).toBe(
        armarReferenciaExterna(TENANT_ID, PEDIDO_ID),
      );
      expect(cuerpo.paymentRequest.referenceId).toBe(cuerpo.referenceId);
    });

    it('usa BACKEND_URL/FRONTEND_URL para los callbacks y redirects', async () => {
      fetchMock.mockResolvedValue(respuesta(200, sesionCreada()));

      await new PlexoGateway().cobrar(solicitud());

      const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(cuerpo.settings.callbacks.paymentCallbackUrl).toBe(
        'https://bistrolink-api-staging.up.railway.app/webhooks/plexo',
      );
      expect(cuerpo.settings.redirects.defaultUrl).toBe(
        'https://bistrolink-web-staging.up.railway.app/pago-completado',
      );
    });

    it('Plexo rechaza la creación de la sesión (4xx/5xx) => 502, logueado', async () => {
      fetchMock.mockResolvedValue(respuesta(400, { message: 'bad merchant' }));

      await expect(new PlexoGateway().cobrar(solicitud())).rejects.toThrow(
        BadGatewayException,
      );
      expect(Logger.error).toHaveBeenCalled();
    });

    it('la respuesta no trae una acción de tipo EMBEDDED => 502 (no hay nada que mostrarle al comensal)', async () => {
      fetchMock.mockResolvedValue(
        respuesta(200, {
          id: 'ses-1',
          actions: [{ rel: 'self', method: 'REDIRECT', href: 'x' }],
        }),
      );

      await expect(new PlexoGateway().cobrar(solicitud())).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('sin PLEXO_CLIENT_ID/PLEXO_API_KEY: no rompe el arranque, falla recién al cobrar', async () => {
      delete process.env.PLEXO_CLIENT_ID;

      const gateway = new PlexoGateway();
      expect(Logger.warn).toHaveBeenCalled();

      await expect(gateway.cobrar(solicitud())).rejects.toThrow(
        BadGatewayException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sin PLEXO_MERCHANT_ID: falla antes de pegarle a Plexo', async () => {
      delete process.env.PLEXO_MERCHANT_ID;

      await expect(new PlexoGateway().cobrar(solicitud())).rejects.toThrow(
        'PLEXO_MERCHANT_ID',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['BACKEND_URL', 'FRONTEND_URL'])(
      'sin %s: falla antes de pegarle a Plexo (el callback quedaría en "undefined/...")',
      async (variable) => {
        delete process.env[variable];

        await expect(new PlexoGateway().cobrar(solicitud())).rejects.toThrow(
          'BACKEND_URL y FRONTEND_URL',
        );
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('consultarPago (BL-78: notificar y luego consultar)', () => {
    it('lee el estado real del pago con nuestras credenciales', async () => {
      fetchMock.mockResolvedValue(
        respuesta(200, {
          id: 'pay-1',
          status: 'approved',
          amount: { total: 590 },
          referenceId: 'ref-1',
        }),
      );

      const pago = await new PlexoGateway().consultarPago('pay-1');

      expect(pago).toEqual({
        id: 'pay-1',
        status: 'approved',
        totalAmount: 590,
        referenceId: 'ref-1',
      });
      const [url, opciones] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.testing.plexo.com.uy/v1/payments/pay-1');
      expect(opciones.headers.Authorization).toBe(
        `Basic ${Buffer.from('1378:una-api-key').toString('base64')}`,
      );
    });

    it('escapa el id del pago en la URL', async () => {
      fetchMock.mockResolvedValue(
        respuesta(200, { id: 'x', status: 'approved' }),
      );

      await new PlexoGateway().consultarPago('../payments/otro');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.testing.plexo.com.uy/v1/payments/..%2Fpayments%2Fotro',
      );
    });

    it('el pago no existe (404) => null', async () => {
      fetchMock.mockResolvedValue(respuesta(404, { message: 'not found' }));

      await expect(
        new PlexoGateway().consultarPago('pay-fantasma'),
      ).resolves.toBeNull();
    });

    it('Plexo falla (5xx) => 502, para que el webhook se reintente', async () => {
      fetchMock.mockResolvedValue(respuesta(503, { message: 'unavailable' }));

      await expect(new PlexoGateway().consultarPago('pay-1')).rejects.toThrow(
        BadGatewayException,
      );
      expect(Logger.error).toHaveBeenCalled();
    });

    it('sin credenciales configuradas, también falla con 502', async () => {
      delete process.env.PLEXO_API_KEY;

      await expect(new PlexoGateway().consultarPago('pay-1')).rejects.toThrow(
        BadGatewayException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
