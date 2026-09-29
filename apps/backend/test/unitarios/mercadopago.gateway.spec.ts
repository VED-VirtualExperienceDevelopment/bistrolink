import {
  BadGatewayException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  idempotencyKeyMp,
  MercadoPagoGateway,
} from '../../src/pagos/gateways/mercadopago.gateway';
import { SolicitudCobro } from '../../src/pagos/gateways/pago-gateway.interface';
import {
  armarReferenciaExterna,
  leerReferenciaExterna,
} from '../../src/pagos/webhooks/referencia-externa';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function solicitud(overrides: Partial<SolicitudCobro> = {}): SolicitudCobro {
  return {
    monto: new Prisma.Decimal('590'),
    idempotencyKey: 'pago-001',
    pedidoId: PEDIDO_ID,
    tenantId: TENANT_ID,
    datosPasarela: {
      token: 'tok-tarjeta',
      payerEmail: 'comensal@example.com',
      paymentMethodId: 'master',
    },
    ...overrides,
  };
}

function respuestaMp(status: number, cuerpo: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  } as Response;
}

// Forma real de un 402 de Orders (capturada del sandbox de Mercado Pago).
function fallo402(detalle: string) {
  return {
    errors: [{ code: 'failed', message: 'The following transactions failed' }],
    data: {
      id: 'ORD-FALLIDA',
      status: 'failed',
      transactions: {
        payments: [{ status: 'failed', status_detail: detalle }],
      },
    },
  };
}

describe('MercadoPagoGateway', () => {
  let fetchMock: jest.SpyInstance;
  const envOriginal = { ...process.env };

  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = 'APP_USR-111-092101-clave-999';
    delete process.env.MP_FORCE_PAYER_EMAIL;
    jest.spyOn(Logger, 'log').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    process.env = { ...envOriginal };
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('falla si MP_ACCESS_TOKEN no está configurado', () => {
      delete process.env.MP_ACCESS_TOKEN;
      expect(() => new MercadoPagoGateway()).toThrow('MP_ACCESS_TOKEN');
    });

    it('loguea solo el n° de app y el usuario, nunca el token', () => {
      new MercadoPagoGateway();
      const mensaje = (Logger.log as jest.Mock).mock.calls[0][0] as string;
      expect(mensaje).toContain('111');
      expect(mensaje).toContain('999');
      expect(mensaje).not.toContain('clave');
    });
  });

  describe('cobrar - resultados', () => {
    it('order procesada y acreditada => aprobado', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(201, {
          id: 'ORD1',
          status: 'processed',
          status_detail: 'accredited',
        }),
      );

      const resultado = await new MercadoPagoGateway().cobrar(solicitud());

      expect(resultado).toEqual({
        aprobado: true,
        pendiente: false,
        pasarelaReferencia: 'ORD1',
        motivoRechazo: undefined,
      });
    });

    it('order en processing (ej. titular CONT) => pendiente, ni aprobado ni rechazado', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(201, {
          id: 'ORD2',
          status: 'processing',
          status_detail: 'in_process',
        }),
      );

      const resultado = await new MercadoPagoGateway().cobrar(solicitud());

      expect(resultado.aprobado).toBe(false);
      expect(resultado.pendiente).toBe(true);
      expect(resultado.motivoRechazo).toBeUndefined();
      expect(resultado.pasarelaReferencia).toBe('ORD2');
    });

    it('402 insufficient_amount (titular FUND) => rechazo con motivo, sin lanzar', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(402, fallo402('insufficient_amount')),
      );

      const resultado = await new MercadoPagoGateway().cobrar(solicitud());

      expect(resultado).toEqual({
        aprobado: false,
        pasarelaReferencia: 'ORD-FALLIDA',
        motivoRechazo: 'insufficient_amount',
      });
    });

    it('402 rejected_by_issuer (titular OTHE) => rechazo con motivo, sin lanzar', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(402, fallo402('rejected_by_issuer')),
      );

      const resultado = await new MercadoPagoGateway().cobrar(solicitud());

      expect(resultado.aprobado).toBe(false);
      expect(resultado.motivoRechazo).toBe('rejected_by_issuer');
    });

    it('402 invalid_card_token => BadRequest (dato inválido del cliente, no un rechazo)', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(402, fallo402('invalid_card_token')),
      );

      await expect(
        new MercadoPagoGateway().cobrar(solicitud()),
      ).rejects.toThrow(BadRequestException);
    });

    it('402 con un detalle desconocido => error técnico (502) y queda logueado', async () => {
      fetchMock.mockResolvedValue(respuestaMp(402, fallo402('detalle_nuevo')));

      await expect(
        new MercadoPagoGateway().cobrar(solicitud()),
      ).rejects.toThrow(BadGatewayException);
      expect(Logger.error).toHaveBeenCalled();
    });

    it('500 de Mercado Pago => error técnico (502)', async () => {
      fetchMock.mockResolvedValue(respuestaMp(500, { message: 'internal' }));

      await expect(
        new MercadoPagoGateway().cobrar(solicitud()),
      ).rejects.toThrow(BadGatewayException);
    });

    it('respuesta de error sin cuerpo JSON => 502, no explota', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('no es JSON');
        },
      } as unknown as Response);

      await expect(
        new MercadoPagoGateway().cobrar(solicitud()),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  describe('cobrar - request a Mercado Pago', () => {
    it('arma la order con el formato de Orders, monto con 2 decimales y el token de la tarjeta', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(201, {
          id: 'ORD1',
          status: 'processed',
          status_detail: 'accredited',
        }),
      );

      await new MercadoPagoGateway().cobrar(solicitud());

      const [url, opciones] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.mercadopago.com/v1/orders');
      expect(opciones.method).toBe('POST');
      expect(opciones.headers.Authorization).toBe(
        'Bearer APP_USR-111-092101-clave-999',
      );
      expect(JSON.parse(opciones.body)).toEqual({
        type: 'online',
        processing_mode: 'automatic',
        total_amount: '590.00',
        external_reference: armarReferenciaExterna(TENANT_ID, PEDIDO_ID),
        payer: { email: 'comensal@example.com' },
        transactions: {
          payments: [
            {
              amount: '590.00',
              payment_method: {
                id: 'master',
                type: 'credit_card',
                token: 'tok-tarjeta',
                installments: 1,
              },
            },
          ],
        },
      });
    });

    it('soporta tarjeta de débito y cuotas', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(201, {
          id: 'ORD1',
          status: 'processed',
          status_detail: 'accredited',
        }),
      );

      await new MercadoPagoGateway().cobrar(
        solicitud({
          datosPasarela: {
            token: 'tok',
            payerEmail: 'a@b.com',
            paymentMethodId: 'debmaster',
            paymentMethodType: 'debit_card',
            installments: 3,
          },
        }),
      );

      const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(cuerpo.transactions.payments[0].payment_method).toMatchObject({
        id: 'debmaster',
        type: 'debit_card',
        installments: 3,
      });
    });

    it('MP_FORCE_PAYER_EMAIL pisa el email del comensal (sandbox)', async () => {
      process.env.MP_FORCE_PAYER_EMAIL = 'test@testuser.com';
      fetchMock.mockResolvedValue(
        respuestaMp(201, {
          id: 'ORD1',
          status: 'processed',
          status_detail: 'accredited',
        }),
      );

      await new MercadoPagoGateway().cobrar(solicitud());

      const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(cuerpo.payer.email).toBe('test@testuser.com');
    });

    it('BL-78: el external_reference lleva el tenant y el pedido, para que el webhook sepa de quién es el pago', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(201, {
          id: 'ORD1',
          status: 'processed',
          status_detail: 'accredited',
        }),
      );

      await new MercadoPagoGateway().cobrar(solicitud());

      const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(leerReferenciaExterna(cuerpo.external_reference)).toEqual({
        tenantId: TENANT_ID,
        pedidoId: PEDIDO_ID,
      });
      expect(cuerpo.external_reference.length).toBeLessThanOrEqual(64);
    });
  });

  describe('consultarOrden (BL-78: notificar y luego consultar)', () => {
    it('lee el estado real de la order con nuestro token', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(200, {
          id: 'ORD1',
          status: 'processed',
          status_detail: 'accredited',
          total_amount: '590.00',
          external_reference: 'ref-1',
        }),
      );

      const orden = await new MercadoPagoGateway().consultarOrden('ORD1');

      expect(orden).toEqual({
        id: 'ORD1',
        status: 'processed',
        statusDetail: 'accredited',
        totalAmount: '590.00',
        externalReference: 'ref-1',
      });
      const [url, opciones] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.mercadopago.com/v1/orders/ORD1');
      expect(opciones.method).toBeUndefined(); // GET
      expect(opciones.headers.Authorization).toBe(
        'Bearer APP_USR-111-092101-clave-999',
      );
    });

    it('escapa el id de la order en la URL (no se puede inyectar una ruta)', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(200, { id: 'x', status: 'processed' }),
      );

      await new MercadoPagoGateway().consultarOrden('../users/me');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.mercadopago.com/v1/orders/..%2Fusers%2Fme',
      );
    });

    it('la order no existe (404) => null', async () => {
      fetchMock.mockResolvedValue(respuestaMp(404, { message: 'not found' }));

      await expect(
        new MercadoPagoGateway().consultarOrden('ORD-FANTASMA'),
      ).resolves.toBeNull();
    });

    it('Mercado Pago falla (5xx) => 502, para que el webhook se reintente', async () => {
      fetchMock.mockResolvedValue(respuestaMp(503, { message: 'unavailable' }));

      await expect(
        new MercadoPagoGateway().consultarOrden('ORD1'),
      ).rejects.toThrow(BadGatewayException);
      expect(Logger.error).toHaveBeenCalled();
    });

    it('una respuesta incompleta no explota: usa el id consultado y estado vacío', async () => {
      fetchMock.mockResolvedValue(respuestaMp(200, {}));

      await expect(
        new MercadoPagoGateway().consultarOrden('ORD9'),
      ).resolves.toMatchObject({ id: 'ORD9', status: '' });
    });
  });

  describe('cobrar - validaciones (no llegan a Mercado Pago)', () => {
    it.each([
      [
        'sin token de tarjeta',
        { paymentMethodId: 'master', payerEmail: 'a@b.com' },
      ],
      ['sin paymentMethodId', { token: 'tok', payerEmail: 'a@b.com' }],
      ['sin email del pagador', { token: 'tok', paymentMethodId: 'master' }],
    ])('%s => BadRequest y no se llama a la pasarela', async (_caso, datos) => {
      await expect(
        new MercadoPagoGateway().cobrar(solicitud({ datosPasarela: datos })),
      ).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('idempotencyKeyMp', () => {
    it('es un UUID y es determinístico para el mismo (tenant, clave)', () => {
      const a = idempotencyKeyMp(TENANT_ID, 'pago-001');
      expect(a).toMatch(UUID_REGEX);
      expect(idempotencyKeyMp(TENANT_ID, 'pago-001')).toBe(a);
    });

    it('cambia si cambia la clave o el tenant', () => {
      const base = idempotencyKeyMp(TENANT_ID, 'pago-001');
      expect(idempotencyKeyMp(TENANT_ID, 'pago-002')).not.toBe(base);
      expect(
        idempotencyKeyMp('22222222-2222-2222-2222-222222222222', 'pago-001'),
      ).not.toBe(base);
    });

    it('la misma clave llega igual a Mercado Pago en dos reintentos', async () => {
      fetchMock.mockResolvedValue(
        respuestaMp(201, {
          id: 'ORD1',
          status: 'processed',
          status_detail: 'accredited',
        }),
      );
      const gateway = new MercadoPagoGateway();

      await gateway.cobrar(solicitud());
      await gateway.cobrar(solicitud());

      const claves = fetchMock.mock.calls.map(
        (c) => c[1].headers['X-Idempotency-Key'],
      );
      expect(claves[0]).toBe(claves[1]);
    });
  });
});
