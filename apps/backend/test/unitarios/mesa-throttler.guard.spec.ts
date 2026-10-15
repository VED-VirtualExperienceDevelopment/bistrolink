import { MesaThrottlerGuard } from '../../src/mesas/mesa-throttler.guard';

const MESA_DEL_QR = '33333333-3333-3333-3333-333333333333';

describe('MesaThrottlerGuard.getTracker', () => {
  const guard = Object.create(
    MesaThrottlerGuard.prototype,
  ) as MesaThrottlerGuard;
  const getTracker = (req: Record<string, any>): Promise<string> =>
    (guard as any).getTracker(req);

  it('BL-70 / BL-204: trackea por la mesa del QR, no por IP', async () => {
    await expect(
      getTracker({ ip: '10.0.0.1', mesaQr: { mesaId: MESA_DEL_QR } }),
    ).resolves.toBe(MESA_DEL_QR);
  });

  it('sin mesa del QR falla: la ruta tiene que poner MesaQrGuard y MesaQrObligatoriaGuard antes', async () => {
    await expect(getTracker({ ip: '10.0.0.1', params: {} })).rejects.toThrow(
      'MesaThrottlerGuard necesita la mesa del QR',
    );
  });
});
