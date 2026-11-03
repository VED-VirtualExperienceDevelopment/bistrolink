import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RolesGuard, ROLES_KEY } from '../../src/auth/roles.guard';
import { StockController } from '../../src/stock/stock.controller';

/** HU-015 (BL-120): /admin/stock. */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const req = {
  user: { sub: 'kc-admin-1', tenantId: TENANT_ID, roles: ['ADMIN'] },
};

describe('StockController (HU-015, BL-120)', () => {
  let stock: { listar: jest.Mock; alertas: jest.Mock; ajustar: jest.Mock };
  let kdsGateway: { emitirStockActualizado: jest.Mock };
  let menuGateway: { emitItemUpdated: jest.Mock };
  let controller: StockController;

  beforeEach(() => {
    stock = {
      listar: jest.fn().mockResolvedValue([]),
      alertas: jest.fn().mockResolvedValue([]),
      ajustar: jest.fn().mockResolvedValue({
        items: [{ id: 'i1' }],
        disponibilidadCambiada: [{ itemId: 'i1', disponible: true }],
      }),
    };
    kdsGateway = { emitirStockActualizado: jest.fn() };
    menuGateway = { emitItemUpdated: jest.fn() };
    controller = new StockController(
      stock as any,
      kdsGateway as any,
      menuGateway as any,
    );
  });

  it('[TC-U-351] BL-122: solo ADMIN, con el token de Keycloak', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StockController)).toEqual(['ADMIN']);
    const guards = Reflect.getMetadata(GUARDS_METADATA, StockController);
    expect(guards).toHaveLength(2);
    expect(guards[1]).toBe(RolesGuard);
  });

  it('[TC-U-352] listar y alertas usan el establecimiento del token', async () => {
    await controller.listar(req);
    await controller.alertas(req);

    expect(stock.listar).toHaveBeenCalledWith(TENANT_ID);
    expect(stock.alertas).toHaveBeenCalledWith(TENANT_ID);
  });

  it('[TC-U-353] ajustar: con el sub como actor; avisa a la carta y a las campanas, y devuelve los ítems', async () => {
    const dto = { items: [{ itemId: 'i1', stockActual: 8 }] };

    await expect(controller.ajustar(req, dto)).resolves.toEqual([{ id: 'i1' }]);
    expect(stock.ajustar).toHaveBeenCalledWith(TENANT_ID, dto, {
      id: 'kc-admin-1',
    });
    expect(menuGateway.emitItemUpdated).toHaveBeenCalledWith(TENANT_ID, {
      itemId: 'i1',
      disponible: true,
    });
    expect(kdsGateway.emitirStockActualizado).toHaveBeenCalledWith(TENANT_ID);
  });
});
