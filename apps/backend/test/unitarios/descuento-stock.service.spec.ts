import { ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DescuentoStockService } from '../../src/stock/descuento-stock.service';

// HU-015 (BL-120): verificación y descuento de stock de un pedido (RF.04,
// RD.09, ADR 0009). La consulta contra la base se prueba en la integración.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = 'pedido-1';
const MILANESA = 'aaaaaaaa-0000-4000-8000-000000000001';
const FLAN = 'aaaaaaaa-0000-4000-8000-000000000002';

describe('DescuentoStockService', () => {
  let tx: {
    lineaPedido: { findMany: jest.Mock };
    itemCarta: { findMany: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let auditLog: { registrarEnTx: jest.Mock };
  let kdsGateway: {
    emitirAlertaStock: jest.Mock;
    emitirStockActualizado: jest.Mock;
  };
  let menuGateway: { emitItemUpdated: jest.Mock };
  let service: DescuentoStockService;

  beforeEach(() => {
    tx = {
      lineaPedido: {
        findMany: jest.fn().mockResolvedValue([
          { itemCartaId: MILANESA, cantidad: 2 },
          { itemCartaId: MILANESA, cantidad: 1 },
          { itemCartaId: FLAN, cantidad: 1 },
        ]),
      },
      itemCarta: { findMany: jest.fn(), update: jest.fn() },
      $queryRaw: jest.fn(),
    };
    auditLog = { registrarEnTx: jest.fn() };
    kdsGateway = {
      emitirAlertaStock: jest.fn(),
      emitirStockActualizado: jest.fn(),
    };
    menuGateway = { emitItemUpdated: jest.fn() };
    service = new DescuentoStockService(
      auditLog as any,
      kdsGateway as any,
      menuGateway as any,
    );
  });

  describe('verificarPedidoEnTx (antes de cobrar)', () => {
    it('[TC-U-342] 409 si no alcanza para lo que pide el pedido (sumando sus líneas)', async () => {
      tx.itemCarta.findMany.mockResolvedValue([
        {
          id: MILANESA,
          nombre: 'Milanesa',
          controlaStock: true,
          stockActual: 2,
          umbralAlerta: 5,
        },
      ]);

      await expect(
        service.verificarPedidoEnTx(tx as any, PEDIDO_ID),
      ).rejects.toThrow(
        new ConflictException(
          'No hay stock suficiente de "Milanesa": quedan 2',
        ),
      );
      expect(tx.itemCarta.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [MILANESA, FLAN] }, controlaStock: true },
        }),
      );
    });

    it('[TC-U-343] alcanza, o el ítem está agotado: pasa o avisa que está agotado', async () => {
      tx.itemCarta.findMany.mockResolvedValueOnce([
        {
          id: MILANESA,
          nombre: 'Milanesa',
          controlaStock: true,
          stockActual: 3,
          umbralAlerta: 5,
        },
      ]);
      await expect(
        service.verificarPedidoEnTx(tx as any, PEDIDO_ID),
      ).resolves.toBeUndefined();

      tx.itemCarta.findMany.mockResolvedValueOnce([
        {
          id: FLAN,
          nombre: 'Flan',
          controlaStock: true,
          stockActual: 0,
          umbralAlerta: 5,
        },
      ]);
      await expect(
        service.verificarPedidoEnTx(tx as any, PEDIDO_ID),
      ).rejects.toThrow('"Flan" está agotado');
    });
  });

  describe('descontarEnTx (al confirmarse el pago)', () => {
    it('[TC-U-344] bloquea las filas del tenant y descuenta; avisa por agotarse y agotado', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          id: MILANESA,
          nombre: 'Milanesa',
          stock_actual: 6,
          umbral_alerta: 5,
          disponible: true,
        },
        {
          id: FLAN,
          nombre: 'Flan',
          stock_actual: 1,
          umbral_alerta: 2,
          disponible: true,
        },
      ]);

      const avisos = await service.descontarEnTx(
        tx as any,
        TENANT_ID,
        PEDIDO_ID,
      );

      const [consulta] = tx.$queryRaw.mock.calls[0] as [Prisma.Sql];
      expect(consulta.sql).toContain('FOR UPDATE');
      expect(consulta.sql).toContain('ORDER BY id');
      expect(consulta.sql).not.toContain(TENANT_ID);
      expect(consulta.values).toEqual(
        expect.arrayContaining([TENANT_ID, MILANESA, FLAN]),
      );
      expect(tx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: MILANESA },
        data: { stockActual: 3, disponible: true },
      });
      expect(tx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: FLAN },
        data: { stockActual: 0, disponible: false },
      });
      expect(avisos).toEqual({
        alertas: [
          {
            itemId: MILANESA,
            nombre: 'Milanesa',
            stockActual: 3,
            umbralAlerta: 5,
            tipo: 'STOCK_CRITICO',
          },
          {
            itemId: FLAN,
            nombre: 'Flan',
            stockActual: 0,
            umbralAlerta: 2,
            tipo: 'AGOTADO',
          },
        ],
        agotados: [FLAN],
      });
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    });

    it('[TC-U-345] arriba del umbral no hay alerta', async () => {
      tx.lineaPedido.findMany.mockResolvedValue([
        { itemCartaId: MILANESA, cantidad: 1 },
      ]);
      tx.$queryRaw.mockResolvedValue([
        {
          id: MILANESA,
          nombre: 'Milanesa',
          stock_actual: 20,
          umbral_alerta: 5,
          disponible: true,
        },
      ]);

      const avisos = await service.descontarEnTx(
        tx as any,
        TENANT_ID,
        PEDIDO_ID,
      );

      expect(tx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: MILANESA },
        data: { stockActual: 19, disponible: true },
      });
      expect(avisos).toEqual({ alertas: [], agotados: [] });
    });

    it('[TC-U-346] ADR 0009: si otro pago se llevó las últimas unidades, queda en 0, avisa cuántas de más y lo audita', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          id: MILANESA,
          nombre: 'Milanesa',
          stock_actual: 1,
          umbral_alerta: 5,
          disponible: true,
        },
      ]);

      const avisos = await service.descontarEnTx(
        tx as any,
        TENANT_ID,
        PEDIDO_ID,
      );

      expect(tx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: MILANESA },
        data: { stockActual: 0, disponible: false },
      });
      expect(avisos.alertas[0]).toEqual({
        itemId: MILANESA,
        nombre: 'Milanesa',
        stockActual: 0,
        umbralAlerta: 5,
        tipo: 'AGOTADO',
        vendidoSinStock: 2,
      });
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: 'CARTA_ITEM_VENDIDO_SIN_STOCK',
        tenantId: TENANT_ID,
        actorKeycloakId: 'sistema:confirmacion-de-pago',
        entidadId: MILANESA,
        detalle: { nombre: 'Milanesa', pedidoId: PEDIDO_ID, unidadesDeMas: 2 },
      });
    });

    it('[TC-U-347] sin ítems con control de stock no cambia nada', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      const avisos = await service.descontarEnTx(
        tx as any,
        TENANT_ID,
        PEDIDO_ID,
      );

      expect(tx.itemCarta.update).not.toHaveBeenCalled();
      expect(avisos).toEqual({ alertas: [], agotados: [] });
    });
  });

  it('[TC-U-348] avisar: cada alerta al administrador y los agotados a la carta del comensal', () => {
    const alerta = {
      itemId: FLAN,
      nombre: 'Flan',
      stockActual: 0,
      umbralAlerta: 2,
      tipo: 'AGOTADO' as const,
      vendidoSinStock: 1,
    };
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    service.avisar(TENANT_ID, { alertas: [alerta], agotados: [FLAN] });

    expect(kdsGateway.emitirAlertaStock).toHaveBeenCalledWith(
      TENANT_ID,
      alerta,
    );
    expect(menuGateway.emitItemUpdated).toHaveBeenCalledWith(TENANT_ID, {
      itemId: FLAN,
      disponible: false,
    });
    // La sobreventa también queda en el log.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sin stock'));
    warn.mockRestore();
  });

  describe('reponerEnTx (HU-024, BL-104: pedido cancelado antes de cocina)', () => {
    it('devuelve lo que pidió el pedido; el ítem agotado vuelve a estar disponible', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          id: FLAN,
          nombre: 'Flan',
          stock_actual: 0,
          umbral_alerta: 2,
          disponible: false,
        },
        {
          id: MILANESA,
          nombre: 'Milanesa',
          stock_actual: 4,
          umbral_alerta: 5,
          disponible: true,
        },
      ]);

      const disponibles = await service.reponerEnTx(
        tx as any,
        TENANT_ID,
        PEDIDO_ID,
      );

      expect(tx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: FLAN },
        data: { stockActual: 1, disponible: true },
      });
      expect(tx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: MILANESA },
        data: { stockActual: 7 },
      });
      expect(disponibles).toEqual([FLAN]);
    });

    it('un ítem sin stock pero deshabilitado a mano (con stock) no se toca su disponibilidad', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          id: MILANESA,
          nombre: 'Milanesa',
          stock_actual: 3,
          umbral_alerta: 5,
          disponible: false,
        },
      ]);

      await expect(
        service.reponerEnTx(tx as any, TENANT_ID, PEDIDO_ID),
      ).resolves.toEqual([]);
      expect(tx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: MILANESA },
        data: { stockActual: 6 },
      });
    });

    it('pedido sin líneas: no consulta nada', async () => {
      tx.lineaPedido.findMany.mockResolvedValue([]);

      await expect(
        service.reponerEnTx(tx as any, TENANT_ID, PEDIDO_ID),
      ).resolves.toEqual([]);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('después del commit avisa al panel de stock y a la carta', () => {
      service.avisarReposicion(TENANT_ID, [FLAN]);

      expect(kdsGateway.emitirStockActualizado).toHaveBeenCalledWith(TENANT_ID);
      expect(menuGateway.emitItemUpdated).toHaveBeenCalledWith(TENANT_ID, {
        itemId: FLAN,
        disponible: true,
      });
    });
  });
});
