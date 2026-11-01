import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RolesGuard, ROLES_KEY } from '../../src/auth/roles.guard';
import { ConfiguracionController } from '../../src/configuracion/configuracion.controller';

/** HU-020 (BL-72): GET y PATCH /admin/configuracion. */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const req = {
  user: { sub: 'kc-admin-1', tenantId: TENANT_ID, roles: ['ADMIN'] },
};

describe('ConfiguracionController (HU-020, BL-72)', () => {
  let configuracion: { obtener: jest.Mock; actualizar: jest.Mock };
  let controller: ConfiguracionController;

  beforeEach(() => {
    configuracion = {
      obtener: jest.fn().mockResolvedValue({ rut: '219999990016' }),
      actualizar: jest.fn().mockResolvedValue({ plexoHabilitado: false }),
    };
    controller = new ConfiguracionController(configuracion as any);
  });

  it('solo ADMIN, con el token de Keycloak', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ConfiguracionController)).toEqual([
      'ADMIN',
    ]);
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ConfiguracionController,
    );
    expect(guards).toHaveLength(2);
    expect(guards[1]).toBe(RolesGuard);
  });

  it('GET lee la configuración del establecimiento del token', async () => {
    await expect(controller.obtener(req)).resolves.toEqual({
      rut: '219999990016',
    });
    expect(configuracion.obtener).toHaveBeenCalledWith(TENANT_ID);
  });

  it('PATCH cambia la del establecimiento del token, con el sub como actor', async () => {
    await controller.actualizar(req, { plexoHabilitado: false });

    expect(configuracion.actualizar).toHaveBeenCalledWith(
      TENANT_ID,
      { plexoHabilitado: false },
      { id: 'kc-admin-1' },
    );
  });
});
