import { MenuAdminThrottlerGuard } from '../../src/menu/menu-admin-throttler.guard';

// BL-391 (BL-386): el límite de subida y confirmación de imágenes cuenta por
// usuario, no por IP (el personal de un local comparte la red).
describe('MenuAdminThrottlerGuard.getTracker', () => {
  const guard = Object.create(
    MenuAdminThrottlerGuard.prototype,
  ) as MenuAdminThrottlerGuard;
  const getTracker = (req: Record<string, any>): Promise<string> =>
    (guard as any).getTracker(req);

  it('cuenta por el sub del token, no por la IP', async () => {
    await expect(
      getTracker({ ip: '10.0.0.1', user: { sub: 'admin-1' } }),
    ).resolves.toBe('admin-1');
  });

  it('dos usuarios en la misma red tienen cupos distintos', async () => {
    const a = await getTracker({ ip: '10.0.0.1', user: { sub: 'admin-1' } });
    const b = await getTracker({ ip: '10.0.0.1', user: { sub: 'admin-2' } });

    expect(a).not.toBe(b);
  });

  it('sin usuario (no debería pasar: va después de AuthGuard) usa la IP', async () => {
    await expect(getTracker({ ip: '10.0.0.1' })).resolves.toBe('10.0.0.1');
  });
});
