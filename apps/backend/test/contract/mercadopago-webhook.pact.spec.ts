// BL-215 — Contrato del webhook de Mercado Pago (message pact).
//
// En el webhook el sentido se invierte: Mercado Pago nos llama a nosotros.
// Por eso no es un contrato HTTP con mock server, sino un contrato de
// MENSAJE: fija la forma mínima de la notificación que BistroLink necesita
// para procesarla, y prueba que nuestro código la entiende.
//
// Qué NO cubre (y dónde está cubierto):
//   - La firma x-signature (HMAC-SHA256): firma-webhook-mercadopago.spec.ts.
//   - El estado aprobado/rechazado: la notificación no lo trae como dato
//     confiable; se consulta con GET /v1/orders/{id} (contrato HTTP en
//     mercadopago-orders.pact.spec.ts, casos aprobada/rechazada/pendiente).
import { resolve } from 'node:path';
import {
  MatchersV3,
  PactV4,
  SpecificationVersion,
} from '@pact-foundation/pact';
import {
  CuerpoNotificacion,
  QueryNotificacion,
  leerNotificacionOrden,
} from '../../src/pagos/webhooks/notificacion-mercadopago';

const { like, regex } = MatchersV3;

const pact = new PactV4({
  consumer: 'bistrolink-backend',
  provider: 'mercadopago-webhooks',
  dir: resolve(__dirname, '../../pacts'),
  spec: SpecificationVersion.SPECIFICATION_VERSION_V4,
  logLevel: 'warn',
});

// Lo mismo que hace el controller: lee la notificación y, si es de una
// order, la pasa al servicio (acá un doble que registra la llamada).
async function procesarNotificacion(
  query: QueryNotificacion,
  cuerpo: CuerpoNotificacion,
  procesarOrden: (orderId: string) => Promise<unknown>,
): Promise<void> {
  const orderId = leerNotificacionOrden(query, cuerpo);
  if (orderId) {
    await procesarOrden(orderId);
  }
}

describe('Contrato Mercado Pago — notificación de webhook (BL-215)', () => {
  it.each([
    ['order.processed', 'una order procesada (pago aprobado)'],
    ['order.failed', 'una order fallida (pago rechazado)'],
  ])(
    'notificación %s → se consulta la order notificada',
    async (accion, descripcion) => {
      await pact
        .addAsynchronousInteraction()
        .given(`Mercado Pago notifica ${descripcion}`)
        .expectsToReceive(
          `una notificación de webhook de ${descripcion}`,
          (b) => {
            b.withJSONContent({
              type: 'order',
              action: like(accion),
              data: { id: like('ORD01JQ4S4KY8HWQ6NA5PXB65B3D3') },
            }).withMetadata({
              // Headers y query con los que llega la notificación; son los que
              // entran en el manifiesto de la firma.
              'x-signature': regex(
                '^ts=\\d+,v1=[0-9a-f]{64}$',
                'ts=1742505638683,v1=ced36ab6d33566bb1e16c125819b8d840d6b8ef136b0b9127c76064466f5229b',
              ),
              'x-request-id': like('bb56a2f1-6aae-46ac-982e-9dcd3581d08e'),
              'query.type': 'order',
              'query.data.id': like('ORD01JQ4S4KY8HWQ6NA5PXB65B3D3'),
            });
          },
        )
        .executeTest(async (mensaje) => {
          const cuerpo = mensaje.contents.content as CuerpoNotificacion;
          const metadata = mensaje.metadata ?? {};
          const procesarOrden = jest.fn().mockResolvedValue('actualizado');

          await procesarNotificacion(
            {
              type: metadata['query.type'] as string,
              'data.id': metadata['query.data.id'] as string,
            },
            cuerpo,
            procesarOrden,
          );

          expect(procesarOrden).toHaveBeenCalledWith(
            'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3',
          );
        });
    },
  );
});
