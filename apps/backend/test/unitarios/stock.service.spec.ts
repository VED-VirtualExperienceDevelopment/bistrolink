import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockService } from '../../src/stock/stock.service';

// HU-015 (BL-120): stock de la jornada y alertas.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR = { id: 'kc-admin-1' };
const CATEGORIA = { id: 'cat-1', nombre: 'Platos' };

function fila(id: string, valores: Record<string, unknown> = {}) {
  return {
    id,
    nombre: `Item ${id}`,
    disponible: true,
    controlaStock: true,
    stockActual: 10,
    umbralAlerta: 5,
    categoria: CATEGORIA,
    ...valores,
  };
}

describe('StockService', () => {
  let tx: { itemCarta: { findMany: jest.Mock; update: jest.Mock } };
  let auditLog: { registrarEnTx: jest.Mock };
  let service: StockService;

  beforeEach(() => {
    tx = {
      itemCarta: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(({ where, data }) =>
          Promise.resolve(fila(where.id, data)),
        ),
      },
    };
    auditLog = { registrarEnTx: jest.fn() };
    const tenantPrisma = {
      runInTenantContext: jest.fn((_t: string, fn: any) => fn(tx)),
    };
    service = new StockService(tenantPrisma as any, auditLog as any);
  });

  it('[TC-U-330] listar trae los ítems de la carta del tenant (sin archivados) con su alerta', async () => {
    tx.itemCarta.findMany.mockResolvedValue([
      fila('a', { stockActual: 0 }),
      fila('b', { stockActual: 3 }),
      fila('c', { controlaStock: false, stockActual: 0 }),
    ]);

    const items = await service.listar(TENANT_ID);

    expect(tx.itemCarta.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT_ID,
          archivadoEn: null,
          categoria: { archivadaEn: null },
        },
      }),
    );
    expect(items.map((i) => i.alerta)).toEqual([
      'AGOTADO',
      'STOCK_CRITICO',
      null,
    ]);
  });

  it('[TC-U-331] alertas: solo nombre y cantidades, los agotados primero', async () => {
    tx.itemCarta.findMany.mockResolvedValue([
      fila('a', { nombre: 'Flan', stockActual: 4 }),
      fila('b', { nombre: 'Agua', stockActual: 20 }),
      fila('c', { nombre: 'Milanesa', stockActual: 0 }),
    ]);

    const alertas = await service.alertas(TENANT_ID);

    expect(tx.itemCarta.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          controlaStock: true,
        }),
      }),
    );
    expect(alertas).toEqual([
      {
        itemId: 'c',
        nombre: 'Milanesa',
        stockActual: 0,
        umbralAlerta: 5,
        tipo: 'AGOTADO',
      },
      {
        itemId: 'a',
        nombre: 'Flan',
        stockActual: 4,
        umbralAlerta: 5,
        tipo: 'STOCK_CRITICO',
      },
    ]);
  });

  it('[TC-U-332] la carga de la jornada guarda lo que cambió y lo audita con antes y después', async () => {
    tx.itemCarta.findMany.mockResolvedValue([
      fila('a', { controlaStock: false, stockActual: 0 }),
    ]);

    const resultado = await service.ajustar(
      TENANT_ID,
      { items: [{ itemId: 'a', controlaStock: true, stockActual: 12 }] },
      ACTOR,
    );

    expect(tx.itemCarta.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a' },
        data: {
          controlaStock: true,
          stockActual: 12,
          umbralAlerta: 5,
          disponible: true,
        },
      }),
    );
    expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
      action: 'CARTA_ITEM_STOCK_AJUSTADO',
      tenantId: TENANT_ID,
      actorKeycloakId: ACTOR.id,
      entidadId: 'a',
      antes: { controlaStock: false, stockActual: 0 },
      despues: { controlaStock: true, stockActual: 12 },
      detalle: { nombre: 'Item a' },
    });
    expect(resultado.items[0]).toMatchObject({ stockActual: 12, alerta: null });
    expect(resultado.disponibilidadCambiada).toEqual([]);
  });

  it('[TC-U-333] reponer un agotado lo vuelve a habilitar; dejarlo en 0 lo deshabilita', async () => {
    tx.itemCarta.findMany.mockResolvedValue([
      fila('a', { stockActual: 0, disponible: false }),
      fila('b', { stockActual: 4, disponible: true }),
    ]);

    const resultado = await service.ajustar(
      TENANT_ID,
      {
        items: [
          { itemId: 'a', stockActual: 8 },
          { itemId: 'b', stockActual: 0 },
        ],
      },
      ACTOR,
    );

    expect(resultado.disponibilidadCambiada).toEqual([
      { itemId: 'a', disponible: true },
      { itemId: 'b', disponible: false },
    ]);
    expect(resultado.items.map((i) => i.alerta)).toEqual([null, 'AGOTADO']);
  });

  it('[TC-U-334] sin cambios no escribe ni audita', async () => {
    tx.itemCarta.findMany.mockResolvedValue([fila('a')]);

    await service.ajustar(
      TENANT_ID,
      { items: [{ itemId: 'a', stockActual: 10 }] },
      ACTOR,
    );

    expect(tx.itemCarta.update).not.toHaveBeenCalled();
    expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
  });

  it('[TC-U-335] un ítem repetido da 400 y uno que no es de la carta del tenant da 404', async () => {
    await expect(
      service.ajustar(
        TENANT_ID,
        {
          items: [
            { itemId: 'a', stockActual: 1 },
            { itemId: 'a', stockActual: 2 },
          ],
        },
        ACTOR,
      ),
    ).rejects.toThrow(BadRequestException);

    tx.itemCarta.findMany.mockResolvedValue([fila('a')]);
    await expect(
      service.ajustar(
        TENANT_ID,
        {
          items: [
            { itemId: 'a', stockActual: 1 },
            { itemId: 'otro', stockActual: 2 },
          ],
        },
        ACTOR,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(tx.itemCarta.update).not.toHaveBeenCalled();
  });
});
