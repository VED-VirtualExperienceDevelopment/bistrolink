import { ConflictException, NotFoundException } from '@nestjs/common';
import { MesaEstado, Prisma } from '@prisma/client';
import { MesasService } from '../../src/mesas/mesas.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';

const LAYOUT_EJEMPLO = {
  x: 10,
  y: 20,
  forma: 'CIRCULO' as const,
  ancho: 80,
  alto: 80,
  rotacion: 0,
};

function crearErrorP2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '0.0.0',
  });
}

describe('MesasService.llamarMozo', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let service: MesasService;

  beforeEach(() => {
    mockTenantPrisma = { runInTenantContext: jest.fn() };
    mockKdsGateway = { emitirLlamado: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('rechaza con 404 si la mesa no existe en este tenant', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue(null);

    await expect(service.llamarMozo(TENANT_ID, MESA_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockKdsGateway.emitirLlamado).not.toHaveBeenCalled();
  });

  it('con la mesa encontrada: emite el llamado con id y numero de mesa', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: MESA_ID,
      numero: 5,
    });

    const resultado = await service.llamarMozo(TENANT_ID, MESA_ID);

    expect(mockKdsGateway.emitirLlamado).toHaveBeenCalledWith(
      TENANT_ID,
      MESA_ID,
      5,
    );
    expect(resultado).toEqual({ ok: true });
  });
});

describe('MesasService.obtenerLayout', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = { mesa: { findMany: jest.fn() } };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
    };
    mockKdsGateway = { emitirLlamado: jest.fn(), emitirEstadoMesa: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('devuelve las mesas del restaurante con su layout y estado, excluyendo la mesa virtual', async () => {
    const mesas = [
      {
        id: MESA_ID,
        numero: 1,
        estado: MesaEstado.LIBRE,
        layout: LAYOUT_EJEMPLO,
      },
    ];
    mockTx.mesa.findMany.mockResolvedValue(mesas);

    const resultado = await service.obtenerLayout(TENANT_ID, RESTAURANTE_ID);

    expect(mockTx.mesa.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          esVirtual: false,
        },
        orderBy: { numero: 'asc' },
      }),
    );
    expect(resultado).toEqual(mesas);
  });
});

describe('MesasService.guardarLayout', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = {
      mesa: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
    };
    mockKdsGateway = { emitirLlamado: jest.fn(), emitirEstadoMesa: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('actualiza una mesa existente del mismo tenant y restaurante', async () => {
    mockTx.mesa.findUnique.mockResolvedValue({
      id: MESA_ID,
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
    });
    mockTx.mesa.update.mockResolvedValue({
      id: MESA_ID,
      numero: 1,
      estado: MesaEstado.LIBRE,
      layout: LAYOUT_EJEMPLO,
    });

    const resultado = await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
      { id: MESA_ID, numero: 1, ...LAYOUT_EJEMPLO },
    ]);

    expect(mockTx.mesa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESA_ID },
        data: { layout: LAYOUT_EJEMPLO },
      }),
    );
    expect(resultado).toEqual([
      {
        id: MESA_ID,
        numero: 1,
        estado: MesaEstado.LIBRE,
        layout: LAYOUT_EJEMPLO,
      },
    ]);
  });

  it('rechaza con 404 si la mesa con ese id pertenece a otro restaurante o tenant', async () => {
    mockTx.mesa.findUnique.mockResolvedValue({
      id: MESA_ID,
      tenantId: TENANT_ID_AJENO,
      restauranteId: RESTAURANTE_ID,
    });

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
        { id: MESA_ID, numero: 1, ...LAYOUT_EJEMPLO },
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.mesa.update).not.toHaveBeenCalled();
  });

  it('crea una mesa nueva (sin id) con estado LIBRE por defecto', async () => {
    mockTx.mesa.create.mockResolvedValue({
      id: 'nueva-mesa-id',
      numero: 9,
      estado: MesaEstado.LIBRE,
      layout: LAYOUT_EJEMPLO,
    });

    const resultado = await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
      { numero: 9, ...LAYOUT_EJEMPLO },
    ]);

    expect(mockTx.mesa.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          numero: 9,
          estado: MesaEstado.LIBRE,
          layout: LAYOUT_EJEMPLO,
        }),
      }),
    );
    expect(resultado).toEqual([
      {
        id: 'nueva-mesa-id',
        numero: 9,
        estado: MesaEstado.LIBRE,
        layout: LAYOUT_EJEMPLO,
      },
    ]);
  });

  it('rechaza con 409 si ya existe una mesa con ese numero en el restaurante (P2002)', async () => {
    mockTx.mesa.create.mockRejectedValue(crearErrorP2002());

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
        { numero: 9, ...LAYOUT_EJEMPLO },
      ]),
    ).rejects.toThrow(ConflictException);
  });

  it('repropaga cualquier error que no sea P2002 sin envolverlo en ConflictException', async () => {
    const errorInesperado = new Error('la base de datos no responde');
    mockTx.mesa.create.mockRejectedValue(errorInesperado);

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
        { numero: 9, ...LAYOUT_EJEMPLO },
      ]),
    ).rejects.toThrow(errorInesperado);
  });
});

describe('MesasService.actualizarLayoutMesa', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = {
      mesa: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
    };
    mockKdsGateway = { emitirLlamado: jest.fn(), emitirEstadoMesa: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('rechaza con 404 si la mesa no existe en este tenant', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(null);

    await expect(
      service.actualizarLayoutMesa(TENANT_ID, MESA_ID, LAYOUT_EJEMPLO),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.mesa.update).not.toHaveBeenCalled();
  });

  it('actualiza solo el campo layout, sin tocar numero ni estado', async () => {
    mockTx.mesa.findUnique.mockResolvedValue({ id: MESA_ID });
    mockTx.mesa.update.mockResolvedValue({
      id: MESA_ID,
      numero: 3,
      estado: MesaEstado.OCUPADA,
      layout: LAYOUT_EJEMPLO,
    });

    const resultado = await service.actualizarLayoutMesa(
      TENANT_ID,
      MESA_ID,
      LAYOUT_EJEMPLO,
    );

    expect(mockTx.mesa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESA_ID },
        data: { layout: LAYOUT_EJEMPLO },
      }),
    );
    expect(resultado.layout).toEqual(LAYOUT_EJEMPLO);
  });
});

describe('MesasService.actualizarEstado', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = {
      mesa: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
    };
    mockKdsGateway = { emitirLlamado: jest.fn(), emitirEstadoMesa: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('rechaza con 404 si la mesa no existe en este tenant', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(null);

    await expect(
      service.actualizarEstado(TENANT_ID, MESA_ID, MesaEstado.OCUPADA),
    ).rejects.toThrow(NotFoundException);
    expect(mockKdsGateway.emitirEstadoMesa).not.toHaveBeenCalled();
  });

  it('actualiza el estado y emite el evento por WebSocket con el estado resultante', async () => {
    mockTx.mesa.findUnique.mockResolvedValue({ id: MESA_ID });
    mockTx.mesa.update.mockResolvedValue({
      id: MESA_ID,
      numero: 4,
      estado: MesaEstado.EN_PROCESO_DE_PAGO,
      layout: LAYOUT_EJEMPLO,
    });

    const resultado = await service.actualizarEstado(
      TENANT_ID,
      MESA_ID,
      MesaEstado.EN_PROCESO_DE_PAGO,
    );

    expect(mockTx.mesa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESA_ID },
        data: { estado: MesaEstado.EN_PROCESO_DE_PAGO },
      }),
    );
    expect(mockKdsGateway.emitirEstadoMesa).toHaveBeenCalledWith(
      TENANT_ID,
      MESA_ID,
      MesaEstado.EN_PROCESO_DE_PAGO,
    );
    expect(resultado.estado).toBe(MesaEstado.EN_PROCESO_DE_PAGO);
  });
});
