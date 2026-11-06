import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import {
  LimpiezaCartaService,
  cambiosItemDelSeed,
  esItemDePrueba,
  planificar,
} from '../../src/testing/limpieza-carta.service';
import { LimpiezaPruebasController } from '../../src/testing/limpieza-pruebas.controller';
import {
  CATEGORIAS_DEL_SEED,
  ITEMS_DEL_SEED,
} from '../../src/testing/datos-seed';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

// BL-480 (BL-285, ADR 0011): carta y stock como el seed.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR = 'kc-admin-1';
const [CAT_PLATOS, CAT_BEBIDAS] = CATEGORIAS_DEL_SEED;
const [MILANESA, AGUA] = ITEMS_DEL_SEED;

function categoria(
  id: string,
  nombre: string,
  extra: { activo?: boolean; archivadaEn?: Date | null } = {},
) {
  return { id, nombre, activo: true, archivadaEn: null, ...extra };
}

function item(
  id: string,
  nombre: string,
  categoriaId: string,
  extra: Partial<{
    precio: string;
    disponible: boolean;
    archivadoEn: Date | null;
    controlaStock: boolean;
    stockActual: number;
    umbralAlerta: number;
    pedidos: number;
  }> = {},
) {
  const { pedidos = 0, precio = '100', ...resto } = extra;
  return {
    id,
    nombre,
    categoriaId,
    precio: new Prisma.Decimal(precio),
    disponible: true,
    archivadoEn: null,
    controlaStock: false,
    stockActual: 0,
    umbralAlerta: 5,
    ...resto,
    _count: { lineasPedido: pedidos },
  };
}

/** Los ítems del seed tal como los deja el seed. */
const seedIntacto = () => [
  item(MILANESA.id, 'Milanesa a la napolitana', CAT_PLATOS, { precio: '590' }),
  item(AGUA.id, 'Agua con gas', CAT_BEBIDAS, {
    precio: '90',
    disponible: false,
  }),
];

describe('Reglas de la limpieza de la carta', () => {
  it('[TC-U-442] es de prueba lo que está en una categoría «E2E …» o tiene «E2E» como palabra; nunca un ítem del seed', () => {
    const deCategoriaE2E = new Set(['cat-e2e']);
    expect(
      esItemDePrueba(
        { id: 'a', nombre: 'Postre', categoriaId: 'cat-e2e' },
        deCategoriaE2E,
      ),
    ).toBe(true);
    expect(
      esItemDePrueba(
        { id: 'b', nombre: 'Chivito E2E', categoriaId: CAT_PLATOS },
        deCategoriaE2E,
      ),
    ).toBe(true);
    expect(
      esItemDePrueba(
        { id: 'c', nombre: 'Flan casero', categoriaId: CAT_PLATOS },
        deCategoriaE2E,
      ),
    ).toBe(false);
    // «E2E» dentro de otra palabra no cuenta.
    expect(
      esItemDePrueba(
        { id: 'd', nombre: 'PIZZAE2EX', categoriaId: CAT_PLATOS },
        deCategoriaE2E,
      ),
    ).toBe(false);
    expect(
      esItemDePrueba(
        { id: MILANESA.id, nombre: 'Milanesa E2E', categoriaId: 'cat-e2e' },
        deCategoriaE2E,
      ),
    ).toBe(false);
  });

  it('[TC-U-443] un ítem del seed vuelve a su precio, disponibilidad y categoría, sin control de stock', () => {
    const [milanesa, agua] = seedIntacto();
    expect(cambiosItemDelSeed(milanesa)).toBeNull();
    expect(cambiosItemDelSeed(agua)).toBeNull();
    expect(cambiosItemDelSeed(item('otro', 'Otro', CAT_PLATOS))).toBeNull();

    const tocado = item(MILANESA.id, 'Milanesa', CAT_BEBIDAS, {
      precio: '600',
      disponible: false,
      archivadoEn: new Date(),
      controlaStock: true,
      stockActual: 3,
      umbralAlerta: 2,
    });
    expect(cambiosItemDelSeed(tocado)).toEqual({
      categoria: { connect: { id: CAT_PLATOS } },
      precio: '590',
      disponible: true,
      archivadoEn: null,
      controlaStock: false,
      stockActual: 0,
      umbralAlerta: 5,
    });
    // Basta con un solo campo distinto.
    expect(
      cambiosItemDelSeed(
        item(AGUA.id, 'Agua con gas', CAT_BEBIDAS, {
          precio: '90',
          disponible: false,
          stockActual: 1,
        }),
      ),
    ).not.toBeNull();
  });

  it('[TC-U-444] planificar: borra ítems sin pedidos, archiva los que tienen, y la categoría se borra solo si queda vacía', () => {
    const plan = planificar(
      [
        categoria(CAT_PLATOS, 'Platos principales'),
        categoria(CAT_BEBIDAS, 'Bebidas', { activo: false }),
        categoria('c-vacia', 'E2E carta 1'),
        categoria('c-con-pedidos', 'E2E stock 2'),
        categoria('c-real', 'Postres'),
      ],
      [
        ...seedIntacto(),
        item('i1', 'Chivito E2E', 'c-vacia'),
        item('i2', 'Flan E2E', 'c-vacia', { archivadoEn: new Date() }),
        item('i3', 'Postre E2E 2', 'c-con-pedidos', { pedidos: 1 }),
        item('i4', 'Pancho E2E', 'c-con-pedidos'),
        item('i5', 'Flan casero', 'c-real'),
        item('i6', 'Tarta E2E', 'c-real', {
          pedidos: 2,
          archivadoEn: new Date(),
        }),
      ],
    );

    expect(plan.itemsABorrar).toEqual(['i1', 'i2', 'i4']);
    // i6 ya estaba archivado: no se vuelve a archivar.
    expect(plan.itemsAArchivar).toEqual(['i3']);
    expect(plan.categoriasABorrar).toEqual(['c-vacia']);
    expect(plan.categoriasAArchivar).toEqual(['c-con-pedidos']);
    expect(plan.categoriasDelSeed).toEqual([CAT_BEBIDAS]);
    expect(plan.itemsDelSeed).toEqual([]);
  });
});

describe('LimpiezaCartaService', () => {
  let tx: {
    categoriaCarta: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
    itemCarta: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let auditLog: { registrarEnTx: jest.Mock };
  let service: LimpiezaCartaService;

  beforeEach(() => {
    tx = {
      categoriaCarta: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            categoria(CAT_PLATOS, 'Platos principales'),
            categoria(CAT_BEBIDAS, 'Bebidas'),
          ]),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      itemCarta: {
        findMany: jest.fn().mockResolvedValue(seedIntacto()),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    auditLog = { registrarEnTx: jest.fn() };
    const tenantPrisma = {
      runInTenantContext: jest.fn((_t: string, fn: any) => fn(tx)),
    };
    service = new LimpiezaCartaService(tenantPrisma as any, auditLog as any);
  });

  const escenario = () => {
    tx.categoriaCarta.findMany.mockResolvedValue([
      categoria(CAT_PLATOS, 'Platos principales'),
      categoria(CAT_BEBIDAS, 'Bebidas', { archivadaEn: new Date() }),
      categoria('c-e2e', 'E2E carta 1'),
      categoria('c-e2e-pedidos', 'E2E stock 1'),
    ]);
    tx.itemCarta.findMany.mockResolvedValue([
      item(MILANESA.id, 'Milanesa a la napolitana', CAT_PLATOS, {
        precio: '590',
        controlaStock: true,
        stockActual: 2,
      }),
      item(AGUA.id, 'Agua con gas', CAT_BEBIDAS, {
        precio: '90',
        disponible: false,
      }),
      item('i1', 'Chivito E2E', 'c-e2e'),
      item('i2', 'Postre E2E 1', 'c-e2e-pedidos', { pedidos: 1 }),
    ]);
  };

  it('[TC-U-445] dry-run cuenta lo que haría sin cambiar nada', async () => {
    escenario();

    const resultado = await service.limpiar(TENANT_ID, ACTOR, true);

    expect(resultado).toEqual({
      itemsEliminados: 1,
      itemsArchivados: 1,
      categoriasEliminadas: 1,
      categoriasArchivadas: 1,
      seedRestablecido: 2, // Milanesa (stock) y la categoría Bebidas
      itemsRetirados: [],
      categoriasRetiradas: [],
      seedCambio: false,
    });
    expect(tx.itemCarta.deleteMany).not.toHaveBeenCalled();
    expect(tx.itemCarta.update).not.toHaveBeenCalled();
    expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
  });

  it('[TC-U-446] borra y archiva lo de prueba (ítems antes que categorías), restablece el seed y audita', async () => {
    escenario();

    const resultado = await service.limpiar(TENANT_ID, ACTOR, false);

    expect(tx.itemCarta.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['i1'] } },
    });
    expect(tx.itemCarta.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['i2'] } },
      data: { archivadoEn: expect.any(Date) },
    });
    expect(tx.categoriaCarta.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['c-e2e'] } },
    });
    expect(tx.itemCarta.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.categoriaCarta.deleteMany.mock.invocationCallOrder[0],
    );
    expect(tx.categoriaCarta.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c-e2e-pedidos'] } },
      data: { archivadaEn: expect.any(Date) },
    });
    expect(tx.categoriaCarta.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [CAT_BEBIDAS] } },
      data: { activo: true, archivadaEn: null },
    });
    expect(tx.itemCarta.update).toHaveBeenCalledWith({
      where: { id: MILANESA.id },
      data: expect.objectContaining({ controlaStock: false, stockActual: 0 }),
    });
    expect(auditLog.registrarEnTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: AuditAction.CARTA_ITEM_LIMPIEZA_PRUEBAS,
        tenantId: TENANT_ID,
        actorKeycloakId: ACTOR,
      }),
    );
    expect(resultado).toEqual(
      expect.objectContaining({
        itemsRetirados: ['i1', 'i2'],
        categoriasRetiradas: ['c-e2e', 'c-e2e-pedidos'],
        seedCambio: true,
      }),
    );
  });

  it('[TC-U-447] con la carta como el seed no escribe nada', async () => {
    const resultado = await service.limpiar(TENANT_ID, ACTOR, false);

    expect(resultado.seedRestablecido).toBe(0);
    expect(resultado.seedCambio).toBe(false);
    expect(tx.itemCarta.update).not.toHaveBeenCalled();
    expect(tx.categoriaCarta.updateMany).not.toHaveBeenCalled();
    expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
  });
});

describe('LimpiezaPruebasController · área carta', () => {
  const req = { user: { sub: ACTOR, tenantId: TENANT_ID, roles: ['ADMIN'] } };

  function armar(resultadoCarta: Record<string, unknown>) {
    const limpiezaCarta = {
      limpiar: jest.fn().mockResolvedValue({
        itemsEliminados: 1,
        itemsArchivados: 0,
        categoriasEliminadas: 1,
        categoriasArchivadas: 0,
        seedRestablecido: 1,
        ...resultadoCarta,
      }),
    };
    const kdsGateway = { emitirStockActualizado: jest.fn() };
    const menuGateway = {
      emitItemRetirado: jest.fn(),
      emitCategoriaRetirada: jest.fn(),
      emitCartaReordenada: jest.fn(),
    };
    const controller = new LimpiezaPruebasController(
      { limpiar: jest.fn() } as any,
      { limpiar: jest.fn() } as any,
      limpiezaCarta as any,
      kdsGateway as any,
      menuGateway as any,
      { limpiar: jest.fn() } as any,
      { limpiar: jest.fn() } as any,
    );
    return { controller, limpiezaCarta, kdsGateway, menuGateway };
  }

  it('[TC-U-448] avisa a la carta lo retirado y, si cambió el seed, recarga la carta y la campana de stock', async () => {
    const { controller, limpiezaCarta, kdsGateway, menuGateway } = armar({
      itemsRetirados: ['i1'],
      categoriasRetiradas: ['c1'],
      seedCambio: true,
    });

    const respuesta = await controller.limpiar(req as any, {
      areas: ['carta'],
    });

    expect(limpiezaCarta.limpiar).toHaveBeenCalledWith(TENANT_ID, ACTOR, false);
    expect(respuesta).toEqual({
      dryRun: false,
      carta: {
        itemsEliminados: 1,
        itemsArchivados: 0,
        categoriasEliminadas: 1,
        categoriasArchivadas: 0,
        seedRestablecido: 1,
      },
    });
    expect(menuGateway.emitItemRetirado).toHaveBeenCalledWith(TENANT_ID, {
      itemId: 'i1',
    });
    expect(menuGateway.emitCategoriaRetirada).toHaveBeenCalledWith(TENANT_ID, {
      categoriaId: 'c1',
    });
    expect(menuGateway.emitCartaReordenada).toHaveBeenCalledWith(TENANT_ID);
    expect(kdsGateway.emitirStockActualizado).toHaveBeenCalledWith(TENANT_ID);
  });

  it('[TC-U-449] sin cambios en el seed no recarga; en dry-run no avisa nada', async () => {
    const sinSeed = armar({
      itemsRetirados: ['i1'],
      categoriasRetiradas: [],
      seedCambio: false,
    });
    await sinSeed.controller.limpiar(req as any, { areas: ['carta'] });
    expect(sinSeed.menuGateway.emitItemRetirado).toHaveBeenCalledTimes(1);
    expect(sinSeed.menuGateway.emitCartaReordenada).not.toHaveBeenCalled();
    expect(sinSeed.kdsGateway.emitirStockActualizado).not.toHaveBeenCalled();

    const enDryRun = armar({
      itemsRetirados: [],
      categoriasRetiradas: [],
      seedCambio: false,
    });
    await enDryRun.controller.limpiar(req as any, {
      areas: ['carta'],
      dryRun: true,
    });
    expect(enDryRun.limpiezaCarta.limpiar).toHaveBeenCalledWith(
      TENANT_ID,
      ACTOR,
      true,
    );
    expect(enDryRun.menuGateway.emitItemRetirado).not.toHaveBeenCalled();
  });
});
