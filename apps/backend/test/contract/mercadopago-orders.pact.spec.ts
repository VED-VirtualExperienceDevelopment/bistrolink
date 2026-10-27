// BL-215 — Contrato del consumidor: BistroLink (backend) → API Orders de
// Mercado Pago. Cubre lo que usa MercadoPagoGateway:
//   - POST /v1/orders       crear y procesar el cobro (HU-007)
//   - GET  /v1/orders/{id}  consultar el estado real (webhook BL-78, HU-032)
//
// Qué fija el contrato: SOLO los campos que nuestro código lee o envía, con
// matchers de tipo/formato (no valores exactos), salvo los valores de los que
// depende una decisión (status/status_detail). Así el contrato no se rompe
// por campos nuevos de Mercado Pago, pero sí si cambia algo que usamos.
//
// Cada test lleva su [TC-C-NNN]: es el título del caso en el Test Plan
// «Contract-PactJS» de Kiwi TCMS (ver test/contract/README.md).
//
// Los ids de las orders usan fromProviderState: hoy toman el valor de
// ejemplo, y el día que el contrato se verifique contra el sandbox (job
// nocturno) el "provider state" puede inyectar ids reales.
import { resolve } from 'node:path';
import {
  MatchersV3,
  PactV4,
  SpecificationVersion,
} from '@pact-foundation/pact';
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException } from '@nestjs/common';
import { MercadoPagoGateway } from '../../src/pagos/gateways/mercadopago.gateway';
import { SolicitudCobro } from '../../src/pagos/gateways/pago-gateway.interface';
import { armarReferenciaExterna } from '../../src/pagos/webhooks/referencia-externa';

const { like, regex, eachLike, fromProviderState } = MatchersV3;

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const ACCESS_TOKEN = 'APP_USR-1234567890-101726-contrato-987654321';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MONTO = '^\\d+\\.\\d{2}$'; // Orders maneja montos como string con 2 decimales
const REFERENCIA_BISTROLINK = '^v1[A-Za-z0-9_-]{44}$'; // ver referencia-externa.ts

const pact = new PactV4({
  consumer: 'bistrolink-backend',
  provider: 'mercadopago-orders-api',
  dir: resolve(__dirname, '../../pacts'),
  spec: SpecificationVersion.SPECIFICATION_VERSION_V4,
  logLevel: 'warn',
});

function solicitud(overrides: Partial<SolicitudCobro> = {}): SolicitudCobro {
  return {
    monto: new Decimal('590'),
    idempotencyKey: 'pago-001',
    pedidoId: PEDIDO_ID,
    tenantId: TENANT_ID,
    datosPasarela: {
      token: 'tok-tarjeta-prueba',
      payerEmail: 'test@testuser.com',
      paymentMethodId: 'master',
      paymentMethodType: 'credit_card',
    },
    ...overrides,
  };
}

// Request de creación tal como lo arma MercadoPagoGateway.cobrar().
function requestCrearOrden(token = 'tok-tarjeta-prueba') {
  return {
    type: 'online',
    processing_mode: 'automatic',
    total_amount: regex(MONTO, '590.00'),
    external_reference: regex(
      REFERENCIA_BISTROLINK,
      armarReferenciaExterna(TENANT_ID, PEDIDO_ID),
    ),
    payer: { email: like('test@testuser.com') },
    transactions: {
      payments: eachLike({
        amount: regex(MONTO, '590.00'),
        payment_method: {
          id: like('master'),
          type: regex('^(credit_card|debit_card)$', 'credit_card'),
          token: like(token),
          installments: like(1),
        },
      }),
    },
  };
}

const HEADERS_AUTENTICADOS = {
  Authorization: regex('^Bearer \\S+$', `Bearer ${ACCESS_TOKEN}`),
};

describe('Contrato Mercado Pago — API Orders (BL-215)', () => {
  const envOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...envOriginal };
  });

  function gatewayContra(mockUrl: string): MercadoPagoGateway {
    process.env.MP_ACCESS_TOKEN = ACCESS_TOKEN;
    process.env.MP_API_BASE_URL = mockUrl;
    delete process.env.MP_FORCE_PAYER_EMAIL;
    return new MercadoPagoGateway();
  }

  describe('POST /v1/orders — crear el cobro', () => {
    it('[TC-C-001] Mercado Pago Orders: POST /v1/orders con pago aprobado responde 201 con la order procesada y acreditada', async () => {
      await pact
        .addInteraction()
        .given('la tarjeta de prueba del pagador tiene fondos')
        .uponReceiving('una solicitud de cobro con tarjeta que se aprueba')
        .withRequest('POST', '/v1/orders', (b) => {
          b.headers({
            ...HEADERS_AUTENTICADOS,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': regex(
              `^${UUID}$`,
              '0b9a3f5e-6d1c-5e2f-8a7b-1c2d3e4f5a6b',
            ),
          }).jsonBody(requestCrearOrden());
        })
        .willRespondWith(201, (b) => {
          b.jsonBody({
            id: like('ORD01JQ4S4KY8HWQ6NA5PXB65B3D3'),
            status: 'processed',
            status_detail: 'accredited',
          });
        })
        .executeTest(async (mock) => {
          const resultado = await gatewayContra(mock.url).cobrar(solicitud());

          expect(resultado).toEqual({
            aprobado: true,
            pendiente: false,
            pasarelaReferencia: 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3',
            motivoRechazo: undefined,
          });
        });
    });

    it('[TC-C-002] Mercado Pago Orders: POST /v1/orders con rechazo del emisor responde 402 con el motivo en data.transactions', async () => {
      await pact
        .addInteraction()
        .given('la tarjeta de prueba del pagador no tiene fondos suficientes')
        .uponReceiving('una solicitud de cobro que el emisor rechaza')
        .withRequest('POST', '/v1/orders', (b) => {
          b.headers({
            ...HEADERS_AUTENTICADOS,
            'X-Idempotency-Key': regex(
              `^${UUID}$`,
              '0b9a3f5e-6d1c-5e2f-8a7b-1c2d3e4f5a6b',
            ),
          }).jsonBody(requestCrearOrden());
        })
        .willRespondWith(402, (b) => {
          b.jsonBody({
            data: {
              id: like('ORD01JQ4S4KY8HWQ6NA5PXB65RECH'),
              transactions: {
                payments: eachLike({
                  status_detail: regex(
                    '^(insufficient_amount|rejected_by_issuer|max_attempts_exceeded)$',
                    'insufficient_amount',
                  ),
                }),
              },
            },
          });
        })
        .executeTest(async (mock) => {
          const resultado = await gatewayContra(mock.url).cobrar(solicitud());

          expect(resultado).toEqual({
            aprobado: false,
            pasarelaReferencia: 'ORD01JQ4S4KY8HWQ6NA5PXB65RECH',
            motivoRechazo: 'insufficient_amount',
          });
        });
    });

    it('[TC-C-003] Mercado Pago Orders: POST /v1/orders con un token de tarjeta inválido o ya usado responde 402 invalid_card_token', async () => {
      await pact
        .addInteraction()
        .given('el token de tarjeta ya fue usado')
        .uponReceiving(
          'una solicitud de cobro con un token de tarjeta inválido',
        )
        .withRequest('POST', '/v1/orders', (b) => {
          b.headers({
            ...HEADERS_AUTENTICADOS,
            'X-Idempotency-Key': regex(
              `^${UUID}$`,
              '0b9a3f5e-6d1c-5e2f-8a7b-1c2d3e4f5a6b',
            ),
          }).jsonBody(requestCrearOrden('tok-ya-usado'));
        })
        .willRespondWith(402, (b) => {
          b.jsonBody({
            data: {
              transactions: {
                payments: eachLike({ status_detail: 'invalid_card_token' }),
              },
            },
          });
        })
        .executeTest(async (mock) => {
          const gateway = gatewayContra(mock.url);
          const datos = { ...solicitud().datosPasarela, token: 'tok-ya-usado' };

          await expect(
            gateway.cobrar(solicitud({ datosPasarela: datos })),
          ).rejects.toBeInstanceOf(BadRequestException);
        });
    });
  });

  describe('GET /v1/orders/{id} — consultar el estado (webhook y HU-032)', () => {
    const pathOrden = fromProviderState(
      '/v1/orders/${orderId}',
      '/v1/orders/ORD01JQ4S4KY8HWQ6NA5PXB65B3D3',
    );

    // Lo que devuelve consultarOrden() y usa PagosWebhookService. El
    // status_detail solo es exacto cuando decide algo (accredited =
    // aprobado); en los demás casos alcanza con que sea un string.
    function cuerpoOrden(status: string, statusDetail: string) {
      return {
        id: fromProviderState('${orderId}', 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3'),
        status,
        status_detail:
          statusDetail === 'accredited' ? statusDetail : like(statusDetail),
        total_amount: regex(MONTO, '590.00'),
        external_reference: regex(
          REFERENCIA_BISTROLINK,
          armarReferenciaExterna(TENANT_ID, PEDIDO_ID),
        ),
      };
    }

    // El título completo va en la primera columna (y no armado con %s) para
    // que cada fila tenga su propio [TC-C-NNN] y el script de carga lo lea.
    it.each([
      [
        '[TC-C-004] Mercado Pago Orders: GET /v1/orders/{id} de una order aprobada devuelve processed y accredited',
        'una order aprobada',
        'processed',
        'accredited',
      ],
      [
        '[TC-C-005] Mercado Pago Orders: GET /v1/orders/{id} de una order pendiente devuelve action_required',
        'una order pendiente de acción',
        'action_required',
        'waiting_payment',
      ],
      [
        '[TC-C-006] Mercado Pago Orders: GET /v1/orders/{id} de una order rechazada devuelve failed',
        'una order fallida',
        'failed',
        'insufficient_amount',
      ],
    ])('%s', async (_titulo, estadoProveedor, status, statusDetail) => {
      await pact
        .addInteraction()
        .given(`existe ${estadoProveedor} creada por BistroLink`, {
          orderId: 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3',
        })
        .uponReceiving(`la consulta de ${estadoProveedor}`)
        .withRequest('GET', pathOrden, (b) => {
          b.headers(HEADERS_AUTENTICADOS);
        })
        .willRespondWith(200, (b) => {
          b.jsonBody(cuerpoOrden(status, statusDetail));
        })
        .executeTest(async (mock) => {
          const orden = await gatewayContra(mock.url).consultarOrden(
            'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3',
          );

          expect(orden).toEqual({
            id: 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3',
            status,
            statusDetail,
            totalAmount: '590.00',
            externalReference: armarReferenciaExterna(TENANT_ID, PEDIDO_ID),
          });
        });
    });

    it('[TC-C-007] Mercado Pago Orders: GET /v1/orders/{id} de una order inexistente responde 404 y el gateway devuelve null', async () => {
      await pact
        .addInteraction()
        .given('no existe la order consultada')
        .uponReceiving('la consulta de una order que no existe')
        .withRequest('GET', '/v1/orders/ORD-INEXISTENTE', (b) => {
          b.headers(HEADERS_AUTENTICADOS);
        })
        .willRespondWith(404)
        .executeTest(async (mock) => {
          const orden = await gatewayContra(mock.url).consultarOrden(
            'ORD-INEXISTENTE',
          );

          expect(orden).toBeNull();
        });
    });
  });
});
