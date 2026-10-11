import { MesaThrottlerGuard } from '../../src/mesas/mesa-throttler.guard';

const MESA_DEL_PATH = '33333333-3333-3333-3333-333333333333';
const MESA_DEL_QR = '44444444-4444-4444-4444-444444444444';

describe('MesaThrottlerGuard.getTracker', () => {
  const guard = Object.create(
    MesaThrottlerGuard.prototype,
  ) as MesaThrottlerGuard;
  const getTracker = (req: Record<string, any>): Promise<string> =>
    (guard as any).getTracker(req);

  it('trackea por mesaId (params.id), no por IP', async () => {
    await expect(
      getTracker({ ip: '10.0.0.1', params: { id: MESA_DEL_PATH } }),
    ).resolves.toBe(MESA_DEL_PATH);
  });

  it('BL-204: con QR, trackea por la mesa del QR (POST /mesas/llamar no lleva id)', async () => {
    await expect(
      getTracker({
        ip: '10.0.0.1',
        params: {},
        mesaQr: { mesaId: MESA_DEL_QR },
      }),
    ).resolves.toBe(MESA_DEL_QR);
  });

  it('BL-204: si vienen las dos, manda la mesa del QR y no la del path', async () => {
    await expect(
      getTracker({
        params: { id: MESA_DEL_PATH },
        mesaQr: { mesaId: MESA_DEL_QR },
      }),
    ).resolves.toBe(MESA_DEL_QR);
  });
});
