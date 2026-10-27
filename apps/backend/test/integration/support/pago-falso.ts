import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { CfeService } from '../../../src/cfe/cfe.service';
import { PagoGatewayFactory } from '../../../src/pagos/gateways/pago-gateway.factory';
import type {
  PagoGateway,
  ResultadoCobro,
  SolicitudCobro,
} from '../../../src/pagos/gateways/pago-gateway.interface';

/**
 * BL-311 (prepago, RD.03): el pedido se crea en PENDIENTE_PAGO y recién con
 * el pago aprobado pasa a RECIBIDO y llega al KDS. Los tests de integración
 * que necesitan un pedido en cocina lo pagan con POST /pedidos/:id/pagos,
 * igual que el frontend, pero contra una pasarela FALSA que aprueba siempre:
 * no se conecta a Mercado Pago ni necesita claves.
 *
 * Lo que se prueba es nuestro flujo (validación del acceso al pedido,
 * monto calculado en el backend, confirmación del pedido en la misma
 * transacción, aviso al KDS, mesa). La integración real con Mercado Pago la
 * cubren los tests de contrato (Pact) y los E2E contra el sandbox.
 */
class PagoGatewayFalso implements PagoGateway {
  cobrar(solicitud: SolicitudCobro): Promise<ResultadoCobro> {
    return Promise.resolve({
      aprobado: true,
      pasarelaReferencia: `FALSO-${solicitud.idempotencyKey}`,
    });
  }
}

const gatewayFalso = new PagoGatewayFalso();

/**
 * Reemplaza la pasarela y la emisión del CFE. El CFE se apaga para no
 * llamar a Surtec desde los tests (con SURTEC_USER en el .env emitiría
 * comprobantes de prueba reales en segundo plano).
 */
export function conPagoFalso(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return builder
    .overrideProvider(PagoGatewayFactory)
    .useValue({ obtener: () => gatewayFalso })
    .overrideProvider(CfeService)
    .useValue({
      emitirEnSegundoPlano: () => undefined,
      intentarEmitir: () => Promise.resolve(null),
    });
}

/**
 * Paga un pedido de MESA con la pasarela falsa. Mismas credenciales que el
 * frontend: el token del comensal y el del QR de la mesa (RD.05).
 */
export async function pagarPedidoDeMesa(
  app: INestApplication,
  pedidoId: string,
  tokenComensal: string,
  qrToken: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/pedidos/${pedidoId}/pagos`)
    .set('Authorization', `Bearer ${tokenComensal}`)
    .set('X-Mesa-Token', qrToken)
    .send({
      idempotencyKey: `it-${pedidoId}`,
      medioPago: 'MERCADOPAGO',
      datosPasarela: {},
    })
    .expect(201);
}
