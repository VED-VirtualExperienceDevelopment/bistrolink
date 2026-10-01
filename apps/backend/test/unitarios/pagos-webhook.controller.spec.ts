import { createHmac } from 'node:crypto';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { PagosWebhookController } from '../../src/pagos/webhooks/pagos-webhook.controller';

const SECRET = 'secreto-de-prueba';
const ORDER_ID = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
const REQUEST_ID = '4ed4fa2b-0b31-42ec-a62f-ad793c486c59';
const TS = '1742505638683';

// Arma el header como lo haría Mercado Pago (data.id en minúsculas en el manifiesto).
function firmar(dataId: string, secret = SECRET) {
  const manifiesto = `id:${dataId.toLowerCase()};request-id:${REQUEST_ID};ts:${TS};`;
  const v1 = createHmac('sha256', secret).update(manifiesto).digest('hex');
  return `ts=${TS},v1=${v1}`;
}

describe('PagosWebhookController (BL-78)', () => {
  let webhookService: { procesarOrden: jest.Mock };
  let controller: PagosWebhookController;
  const envOriginal = { ...process.env };

  beforeEach(() => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    jest.spyOn(Logger, 'error').mockImplementation();
    webhookService = {
      procesarOrden: jest.fn().mockResolvedValue('actualizado'),
    };
    controller = new PagosWebhookController(webhookService as any);
  });

  afterEach(() => {
    process.env = { ...envOriginal };
    jest.restoreAllMocks();
  });

  describe('firma válida', () => {
    it('procesa la order notificada y responde 200 {recibido: true}', async () => {
      const respuesta = await controller.recibir(
        firmar(ORDER_ID),
        REQUEST_ID,
        ORDER_ID,
        'order',
        undefined,
      );

      expect(respuesta).toEqual({ recibido: true });
      expect(webhookService.procesarOrden).toHaveBeenCalledWith(ORDER_ID);
    });

    it('el data.id puede venir del body si no vino en la query', async () => {
      const respuesta = await controller.recibir(
        firmar(ORDER_ID),
        REQUEST_ID,
        ORDER_ID,
        undefined,
        { type: 'order', data: { id: ORDER_ID } },
      );

      expect(respuesta).toEqual({ recibido: true });
      expect(webhookService.procesarOrden).toHaveBeenCalledWith(ORDER_ID);
    });

    it('otro tipo de evento (ej. payment): se confirma con 200 pero no se procesa', async () => {
      const respuesta = await controller.recibir(
        firmar(ORDER_ID),
        REQUEST_ID,
        ORDER_ID,
        'payment',
        undefined,
      );

      expect(respuesta).toEqual({ recibido: true });
      expect(webhookService.procesarOrden).not.toHaveBeenCalled();
    });

    it('sin id de order: si la firma es válida se confirma con 200 y no se procesa nada', async () => {
      // Sin data.id, el par "id:" se omite del manifiesto.
      const manifiesto = `request-id:${REQUEST_ID};ts:${TS};`;
      const v1 = createHmac('sha256', SECRET).update(manifiesto).digest('hex');

      const respuesta = await controller.recibir(
        `ts=${TS},v1=${v1}`,
        REQUEST_ID,
        undefined,
        'order',
        undefined,
      );

      expect(respuesta).toEqual({ recibido: true });
      expect(webhookService.procesarOrden).not.toHaveBeenCalled();
    });

    it('si procesar falla (Mercado Pago o la base caídos) el error SUBE, para que Mercado Pago reintente', async () => {
      webhookService.procesarOrden.mockRejectedValue(new Error('base caída'));

      await expect(
        controller.recibir(
          firmar(ORDER_ID),
          REQUEST_ID,
          ORDER_ID,
          'order',
          undefined,
        ),
      ).rejects.toThrow('base caída');
    });
  });

  describe('firma inválida => 401 y NO se procesa nada', () => {
    it.each([
      ['firmada con otro secret', () => firmar(ORDER_ID, 'otro-secreto')],
      ['firma de otra order', () => firmar('ORD01OTRAORDEN')],
      ['sin header x-signature', () => undefined],
      ['header sin formato', () => 'basura'],
    ])('%s', async (_caso, header) => {
      await expect(
        controller.recibir(header(), REQUEST_ID, ORDER_ID, 'order', undefined),
      ).rejects.toThrow(UnauthorizedException);

      expect(webhookService.procesarOrden).not.toHaveBeenCalled();
    });

    it('x-request-id distinto al firmado', async () => {
      await expect(
        controller.recibir(
          firmar(ORDER_ID),
          'otro-request-id',
          ORDER_ID,
          'order',
          undefined,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('sin MP_WEBHOOK_SECRET configurado se rechaza TODO (falla cerrado) y queda logueado', async () => {
      delete process.env.MP_WEBHOOK_SECRET;

      await expect(
        controller.recibir(
          firmar(ORDER_ID),
          REQUEST_ID,
          ORDER_ID,
          'order',
          undefined,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(Logger.error).toHaveBeenCalled();
      expect(webhookService.procesarOrden).not.toHaveBeenCalled();
    });

    it('un atacante que conoce el formato pero no el secret no puede forzar un pago aprobado', async () => {
      const falsa = createHmac('sha256', 'adivinando')
        .update(
          `id:${ORDER_ID.toLowerCase()};request-id:${REQUEST_ID};ts:${TS};`,
        )
        .digest('hex');

      await expect(
        controller.recibir(
          `ts=${TS},v1=${falsa}`,
          REQUEST_ID,
          ORDER_ID,
          'order',
          undefined,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
