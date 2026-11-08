// BL-488 (HU-011) — Contrato del consumidor: BistroLink (backend) → API de
// POS. La API la define BistroLink: un POS que quiera recibir las ventas
// implementa estos endpoints (o se le escribe un adaptador propio). Cubre lo
// que usa PosHttpAdapter:
//   - POST /ventas                 registrar la venta cobrada (idempotente)
//   - POST /ventas/{id}/anulacion  anularla si el pedido se cancela (HU-024)
//
// Igual que los otros contratos: se fija solo lo que BistroLink manda o lee,
// con matchers de tipo/formato, y valores exactos solo donde el código toma
// una decisión (el status HTTP).
//
// Cada test lleva su [TC-C-NNN]: es el título del caso en el Test Plan
// «Contract-PactJS» de Kiwi TCMS (ver test/contract/README.md).
import { resolve } from 'node:path';
import {
  MatchersV3,
  PactV4,
  SpecificationVersion,
} from '@pact-foundation/pact';
import { PosHttpAdapter } from '../../src/pos/pos-http.adapter';
import { PosNoDisponibleError, VentaPos } from '../../src/pos/pos.adapter';

const { like, regex, eachLike, number, integer } = MatchersV3;

const TOKEN = 'pos-token-de-contrato';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const ID_POS = 'V-000123';

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const FECHA_ISO = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$';

const pact = new PactV4({
  consumer: 'bistrolink-backend',
  provider: 'pos-api',
  dir: resolve(__dirname, '../../pacts'),
  spec: SpecificationVersion.SPECIFICATION_VERSION_V4,
  logLevel: 'warn',
});

const VENTA: VentaPos = {
  referencia: PEDIDO_ID,
  fecha: '2026-11-08T15:30:00.000Z',
  moneda: 'UYU',
  total: 590.5,
  medioPago: 'MERCADOPAGO',
  mesa: 7,
  lineas: [
    {
      descripcion: 'Milanesa al plato',
      cantidad: 1,
      precioUnitario: 450.5,
      subtotal: 450.5,
    },
    {
      descripcion: 'Agua sin gas',
      cantidad: 2,
      precioUnitario: 70,
      subtotal: 140,
    },
  ],
};

// Body tal como lo arma PosHttpAdapter.registrarVenta() (ventaDelPedido).
// Los montos van como número JSON (590.5, o 140 si no tienen centavos): por
// eso `number` y no `decimal`. mesa es null en los pedidos para retirar: se
// fija con el ejemplo de mesa.
const REQUEST_VENTA = {
  referencia: regex(UUID, PEDIDO_ID),
  fecha: regex(FECHA_ISO, VENTA.fecha),
  moneda: 'UYU',
  total: number(590.5),
  medioPago: like('MERCADOPAGO'),
  mesa: integer(7),
  lineas: eachLike({
    descripcion: like('Milanesa al plato'),
    cantidad: integer(1),
    precioUnitario: number(450.5),
    subtotal: number(450.5),
  }),
};

const HEADERS = {
  Authorization: regex('^Bearer \\S+$', `Bearer ${TOKEN}`),
  'Content-Type': 'application/json',
};

function adaptadorContra(mockUrl: string): PosHttpAdapter {
  return new PosHttpAdapter(mockUrl, TOKEN);
}

describe('Contrato API de POS (BL-488)', () => {
  describe('POST /ventas — registrar la venta', () => {
    it('[TC-C-023] API de POS: POST /ventas con una venta nueva responde 201 con el id de la venta en el POS', async () => {
      await pact
        .addInteraction()
        .given('el POS no tiene ninguna venta con esa referencia')
        .uponReceiving('una venta cobrada en BistroLink')
        .withRequest('POST', '/ventas', (b) => {
          b.headers(HEADERS).jsonBody(REQUEST_VENTA);
        })
        .willRespondWith(201, (b) => {
          b.jsonBody({ id: like(ID_POS) });
        })
        .executeTest(async (mock) => {
          await expect(
            adaptadorContra(mock.url).registrarVenta(VENTA),
          ).resolves.toEqual({ idPos: ID_POS });
        });
    });

    it('[TC-C-024] API de POS: POST /ventas con una referencia que ya existe responde 409 con el id de la venta existente (idempotencia)', async () => {
      await pact
        .addInteraction()
        .given('el POS ya tiene una venta con esa referencia')
        .uponReceiving('la misma venta mandada por segunda vez')
        .withRequest('POST', '/ventas', (b) => {
          b.headers(HEADERS).jsonBody(REQUEST_VENTA);
        })
        .willRespondWith(409, (b) => {
          b.jsonBody({ id: like(ID_POS) });
        })
        .executeTest(async (mock) => {
          await expect(
            adaptadorContra(mock.url).registrarVenta(VENTA),
          ).resolves.toEqual({ idPos: ID_POS });
        });
    });

    it('[TC-C-025] API de POS: POST /ventas con el POS no disponible responde 503 y BistroLink lanza PosNoDisponibleError (se reintenta después)', async () => {
      await pact
        .addInteraction()
        .given('el POS está en mantenimiento')
        .uponReceiving('una venta mientras el POS no está disponible')
        .withRequest('POST', '/ventas', (b) => {
          b.headers(HEADERS).jsonBody(REQUEST_VENTA);
        })
        .willRespondWith(503)
        .executeTest(async (mock) => {
          const intento = adaptadorContra(mock.url).registrarVenta(VENTA);
          await expect(intento).rejects.toBeInstanceOf(PosNoDisponibleError);
          await expect(intento).rejects.toThrow(
            'El POS no pudo registrar la venta (HTTP 503)',
          );
        });
    });
  });

  describe('POST /ventas/{id}/anulacion — anular la venta', () => {
    it('[TC-C-026] API de POS: POST /ventas/{id}/anulacion con el motivo responde 200 y la venta queda anulada', async () => {
      await pact
        .addInteraction()
        .given('el POS tiene la venta registrada y sin anular')
        .uponReceiving('la anulación de una venta por cancelación del pedido')
        .withRequest('POST', `/ventas/${ID_POS}/anulacion`, (b) => {
          b.headers(HEADERS).jsonBody({
            motivo: like('Pedido cancelado en BistroLink'),
          });
        })
        .willRespondWith(200)
        .executeTest(async (mock) => {
          await expect(
            adaptadorContra(mock.url).anularVenta(
              ID_POS,
              'Pedido cancelado en BistroLink',
            ),
          ).resolves.toBeUndefined();
        });
    });
  });
});
