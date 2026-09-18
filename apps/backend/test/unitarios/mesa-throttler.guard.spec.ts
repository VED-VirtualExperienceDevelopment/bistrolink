import { MesaThrottlerGuard } from '../../src/mesas/mesa-throttler.guard';

describe('MesaThrottlerGuard.getTracker', () => {
  it('trackea por mesaId (params.id), no por IP', async () => {
    const guard = Object.create(
      MesaThrottlerGuard.prototype,
    ) as MesaThrottlerGuard;

    const tracker = await (guard as any).getTracker({
      params: { id: '33333333-3333-3333-3333-333333333333' },
    });

    expect(tracker).toBe('33333333-3333-3333-3333-333333333333');
  });
});
