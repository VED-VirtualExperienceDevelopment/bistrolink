import { Logger } from '@nestjs/common';
import { PlexoWebhookController } from '../../src/pagos/webhooks/plexo-webhook.controller';

describe('PlexoWebhookController (BL-78)', () => {
  let webhookService: { procesarPago: jest.Mock };
  let controller: PlexoWebhookController;

  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    webhookService = {
      procesarPago: jest.fn().mockResolvedValue('actualizado'),
    };
    controller = new PlexoWebhookController(webhookService as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('procesa el pago notificado y responde 200 {recibido: true}', async () => {
    const respuesta = await controller.recibir({ id: 'pay-1' });

    expect(respuesta).toEqual({ recibido: true });
    expect(webhookService.procesarPago).toHaveBeenCalledWith('pay-1');
  });

  it('sin id de pago: se confirma con 200 y no se procesa nada', async () => {
    const respuesta = await controller.recibir({});

    expect(respuesta).toEqual({ recibido: true });
    expect(webhookService.procesarPago).not.toHaveBeenCalled();
    expect(Logger.warn).toHaveBeenCalled();
  });

  it('cuerpo vacío/undefined: no explota', async () => {
    const respuesta = await controller.recibir(undefined);

    expect(respuesta).toEqual({ recibido: true });
    expect(webhookService.procesarPago).not.toHaveBeenCalled();
  });

  it('si procesar falla (Plexo o la base caídos), el error SUBE para que Plexo reintente', async () => {
    webhookService.procesarPago.mockRejectedValue(new Error('base caída'));

    await expect(controller.recibir({ id: 'pay-1' })).rejects.toThrow(
      'base caída',
    );
  });
});
