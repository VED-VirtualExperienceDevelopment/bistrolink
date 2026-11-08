import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RolesGuard, ROLES_KEY } from '../../src/auth/roles.guard';
import { ReportesController } from '../../src/reportes/reportes.controller';
import { FiltrosReportesDto } from '../../src/reportes/dto/filtros-reportes.dto';

/** HU-012 (BL-108): GET /admin/reportes. */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const req = {
  user: { sub: 'kc-admin-1', tenantId: TENANT_ID, roles: ['ADMIN'] },
};

describe('ReportesController (HU-012, BL-108)', () => {
  let reportes: { obtener: jest.Mock };
  let controller: ReportesController;

  beforeEach(() => {
    reportes = { obtener: jest.fn().mockResolvedValue({ canal: 'TODOS' }) };
    controller = new ReportesController(reportes as any);
  });

  it('[TC-U-308] solo ADMIN, con el token de Keycloak', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ReportesController)).toEqual([
      'ADMIN',
    ]);
    const guards = Reflect.getMetadata(GUARDS_METADATA, ReportesController);
    expect(guards).toHaveLength(2);
    expect(guards[1]).toBe(RolesGuard);
  });

  it('[TC-U-309] GET pide el reporte del establecimiento del token con los filtros', async () => {
    const filtros = Object.assign(new FiltrosReportesDto(), { canal: 'WEB' });

    await expect(controller.obtener(req, filtros)).resolves.toEqual({
      canal: 'TODOS',
    });
    expect(reportes.obtener).toHaveBeenCalledWith(TENANT_ID, filtros);
  });
});
