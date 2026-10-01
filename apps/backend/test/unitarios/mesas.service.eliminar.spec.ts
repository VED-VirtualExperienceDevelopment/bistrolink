import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MesaEstado, Prisma } from '@prisma/client';
import { MesasService } from '../../src/mesas/mesas.service';

/**
 * BL-58 — eliminación de mesas desde el editor del mapa
 * (guardarLayout con `eliminar` + MesasService.eliminarMesas).
 *
 * Puede quedar como archivo propio o pegarse al final de
 * mesas.service.spec.ts (reusa las mismas constantes).
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const RESTAURANTE_ID_AJENO = '44444444-4444-4444-4444-444444444444';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const MESA_ID_2 = '55555555-5555-5555-5555-555555555555';

const LAYOUT_EJEMPLO = {
  x: 10,
  y: 20,
  forma: 'CIRCULO' as const,
  ancho: 80,
  alto: 80,
  rotacion: 0,
};

function crearErrorPrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: '0.0.0',
  });
}

/** Fila tal como la devuelve el findMany de eliminarMesas: borrable por defecto. */
function mesaBorrable(overrides: Record<string, unknown> = {}) {
  return {
    id: MESA_ID,
    numero: 3,
    estado: MesaEstado.LIBRE,
    esVirtual: false,
    tenantId: TENANT_ID,
    restauranteId: RESTAURANTE_ID,
    _count: { pedidos: 0 },
    ...overrides,
  };
}

describe('MesasService.guardarLayout — eliminar (BL-58)', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = {
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({ tenantId: TENANT_ID }),
      },
      mesa: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
    };
    mockKdsGateway = { emitirLlamado: jest.fn(), emitirEstadoMesa: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('rechaza con 400 si un mismo id viene para actualizar y para eliminar, sin abrir la transacción', async () => {
    await expect(
      service.guardarLayout(
        TENANT_ID,
        RESTAURANTE_ID,
        [{ id: MESA_ID, numero: 1, ...LAYOUT_EJEMPLO }],
        [MESA_ID],
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockTenantPrisma.runInTenantContext).not.toHaveBeenCalled();
  });

  it('sin eliminaciones no consulta ni borra mesas', async () => {
    mockTx.mesa.create.mockResolvedValue({ id: 'nueva', numero: 1 });

    await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
      { numero: 1, ...LAYOUT_EJEMPLO },
    ]);

    expect(mockTx.mesa.findMany).not.toHaveBeenCalled();
    expect(mockTx.mesa.deleteMany).not.toHaveBeenCalled();
  });

  it('guardado con solo eliminaciones: borra filtrando por tenant y restaurante, sin crear ni actualizar', async () => {
    mockTx.mesa.findMany.mockResolvedValue([mesaBorrable()]);

    const resultado = await service.guardarLayout(
      TENANT_ID,
      RESTAURANTE_ID,
      [],
      [MESA_ID],
    );

    expect(mockTx.mesa.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [MESA_ID] } } }),
    );
    expect(mockTx.mesa.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: [MESA_ID] },
        tenantId: TENANT_ID,
        restauranteId: RESTAURANTE_ID,
      },
    });
    expect(mockTx.mesa.create).not.toHaveBeenCalled();
    expect(mockTx.mesa.update).not.toHaveBeenCalled();
    expect(resultado).toEqual([]);
  });

  it('borra antes de crear, para que una mesa nueva pueda reusar el número de una borrada', async () => {
    mockTx.mesa.findMany.mockResolvedValue([mesaBorrable({ numero: 3 })]);
    mockTx.mesa.create.mockResolvedValue({
      id: 'nueva',
      numero: 3,
      estado: MesaEstado.LIBRE,
      layout: LAYOUT_EJEMPLO,
    });

    const resultado = await service.guardarLayout(
      TENANT_ID,
      RESTAURANTE_ID,
      [{ numero: 3, ...LAYOUT_EJEMPLO }],
      [MESA_ID],
    );

    expect(mockTx.mesa.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockTx.mesa.create.mock.invocationCallOrder[0],
    );
    expect(resultado.map((m: any) => m.id)).toEqual(['nueva']);
  });

  it('no borra nada si el restaurante no es de este tenant', async () => {
    mockTx.restaurante.findUnique.mockResolvedValue({
      tenantId: TENANT_ID_AJENO,
    });

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [], [MESA_ID]),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.mesa.findMany).not.toHaveBeenCalled();
    expect(mockTx.mesa.deleteMany).not.toHaveBeenCalled();
  });

  const casos404: [string, Record<string, unknown> | null][] = [
    ['no existe (o RLS la oculta)', null],
    ['es de otro tenant', { tenantId: TENANT_ID_AJENO }],
    [
      'es de otro restaurante del mismo tenant',
      { restauranteId: RESTAURANTE_ID_AJENO },
    ],
    ['es la mesa virtual de HU-003', { numero: 0, esVirtual: true }],
  ];

  it.each(casos404)(
    'rechaza con 404 si la mesa a eliminar %s',
    async (_descripcion, overrides) => {
      mockTx.mesa.findMany.mockResolvedValue(
        overrides === null ? [] : [mesaBorrable(overrides)],
      );

      await expect(
        service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [], [MESA_ID]),
      ).rejects.toThrow(NotFoundException);
      expect(mockTx.mesa.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('si una de varias mesas a eliminar no existe, rechaza el guardado completo', async () => {
    mockTx.mesa.findMany.mockResolvedValue([mesaBorrable()]);

    await expect(
      service.guardarLayout(
        TENANT_ID,
        RESTAURANTE_ID,
        [],
        [MESA_ID, MESA_ID_2],
      ),
    ).rejects.toThrow(`Mesa ${MESA_ID_2} no encontrada`);
    expect(mockTx.mesa.deleteMany).not.toHaveBeenCalled();
  });

  it.each([MesaEstado.OCUPADA, MesaEstado.EN_PROCESO_DE_PAGO])(
    'rechaza con 409 si la mesa a eliminar está %s',
    async (estado) => {
      mockTx.mesa.findMany.mockResolvedValue([mesaBorrable({ estado })]);

      const guardado = service.guardarLayout(
        TENANT_ID,
        RESTAURANTE_ID,
        [],
        [MESA_ID],
      );

      await expect(guardado).rejects.toThrow(ConflictException);
      await expect(guardado).rejects.toThrow(
        'mesas que no están libres (mesa 3)',
      );
      expect(mockTx.mesa.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('lista todas las mesas no libres, ordenadas por número', async () => {
    mockTx.mesa.findMany.mockResolvedValue([
      mesaBorrable({ id: MESA_ID_2, numero: 5, estado: MesaEstado.OCUPADA }),
      mesaBorrable({
        id: MESA_ID,
        numero: 3,
        estado: MesaEstado.EN_PROCESO_DE_PAGO,
      }),
    ]);

    await expect(
      service.guardarLayout(
        TENANT_ID,
        RESTAURANTE_ID,
        [],
        [MESA_ID_2, MESA_ID],
      ),
    ).rejects.toThrow('mesas que no están libres (mesas 3, 5)');
  });

  it('rechaza con 409 si la mesa está libre pero tiene pedidos registrados', async () => {
    mockTx.mesa.findMany.mockResolvedValue([
      mesaBorrable({ _count: { pedidos: 2 } }),
    ]);

    const guardado = service.guardarLayout(
      TENANT_ID,
      RESTAURANTE_ID,
      [],
      [MESA_ID],
    );

    await expect(guardado).rejects.toThrow(ConflictException);
    await expect(guardado).rejects.toThrow(
      'mesas con pedidos registrados (mesa 3)',
    );
    expect(mockTx.mesa.deleteMany).not.toHaveBeenCalled();
  });

  it('carrera: si entra un pedido entre el chequeo y el borrado (P2003), responde 409', async () => {
    mockTx.mesa.findMany.mockResolvedValue([mesaBorrable()]);
    mockTx.mesa.deleteMany.mockRejectedValue(crearErrorPrisma('P2003'));

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [], [MESA_ID]),
    ).rejects.toThrow(ConflictException);
  });

  it('repropaga cualquier otro error del borrado sin envolverlo', async () => {
    const errorInesperado = new Error('la base de datos no responde');
    mockTx.mesa.findMany.mockResolvedValue([mesaBorrable()]);
    mockTx.mesa.deleteMany.mockRejectedValue(errorInesperado);

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [], [MESA_ID]),
    ).rejects.toThrow(errorInesperado);
  });

  it('si falla el borrado no intenta crear ni actualizar las mesas del guardado', async () => {
    mockTx.mesa.findMany.mockResolvedValue([mesaBorrable()]);
    mockTx.mesa.deleteMany.mockRejectedValue(crearErrorPrisma('P2003'));

    await expect(
      service.guardarLayout(
        TENANT_ID,
        RESTAURANTE_ID,
        [{ numero: 7, ...LAYOUT_EJEMPLO }],
        [MESA_ID],
      ),
    ).rejects.toThrow(ConflictException);
    expect(mockTx.mesa.create).not.toHaveBeenCalled();
  });
});
