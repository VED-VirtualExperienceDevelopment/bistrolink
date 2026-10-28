import { NotFoundException } from '@nestjs/common';
import { MesasService, PLANO_VACIO } from '../../src/mesas/mesas.service';
import { PlanoDto } from '../../src/mesas/dto/plano.dto';

/**
 * HU-028 (BL-173): plano del salón (elementos fijos y zonas) guardado en
 * restaurante.plano, junto con el layout de las mesas.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';

const PLANO: PlanoDto = {
  elementos: [
    {
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      tipo: 'COCINA',
      x: 700,
      y: 80,
      ancho: 120,
      alto: 80,
      rotacion: 0,
    },
  ],
  zonas: [
    {
      id: 'bbbbbbbb-2222-4222-8222-222222222222',
      etiqueta: 'Salón',
      x: 300,
      y: 250,
      ancho: 500,
      alto: 400,
    },
  ],
};

function crearService(mockTx: any) {
  const mockTenantPrisma = {
    runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
  };
  const mockKdsGateway = {
    emitirLlamado: jest.fn(),
    emitirEstadoMesa: jest.fn(),
  };
  return new MesasService(
    mockTenantPrisma as any,
    mockKdsGateway as any,
    { registrarEnTx: jest.fn() } as any,
  );
}

describe('MesasService.guardarLayout con plano (HU-028)', () => {
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = {
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({ tenantId: TENANT_ID }),
        update: jest.fn().mockResolvedValue({}),
      },
      mesa: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    service = crearService(mockTx);
  });

  it('guarda el plano en el restaurante, en la misma transacción', async () => {
    await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [], [], PLANO);

    expect(mockTx.restaurante.update).toHaveBeenCalledWith({
      where: { id: RESTAURANTE_ID },
      data: { plano: PLANO },
    });
  });

  it('serializa y deserializa sin perder datos', async () => {
    await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [], [], PLANO);
    const guardado = mockTx.restaurante.update.mock.calls[0][0].data.plano;

    expect(JSON.parse(JSON.stringify(guardado))).toEqual(PLANO);
  });

  it('guarda solo los campos conocidos de cada elemento y zona', async () => {
    const conExtras = {
      elementos: [{ ...PLANO.elementos[0], numero: 9, onclick: 'x()' }],
      zonas: [{ ...PLANO.zonas[0], mesas: ['m1'] }],
    } as unknown as PlanoDto;

    await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [], [], conExtras);

    expect(mockTx.restaurante.update.mock.calls[0][0].data.plano).toEqual(
      PLANO,
    );
  });

  it('si no viene el plano, no toca el guardado (compatibilidad con HU-016)', async () => {
    await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, []);

    expect(mockTx.restaurante.update).not.toHaveBeenCalled();
  });

  it('no guarda el plano en un restaurante de otro tenant', async () => {
    mockTx.restaurante.findUnique.mockResolvedValue({
      tenantId: TENANT_ID_AJENO,
    });

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [], [], PLANO),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.restaurante.update).not.toHaveBeenCalled();
  });
});

describe('MesasService.obtenerPlano (HU-028)', () => {
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = { restaurante: { findUnique: jest.fn() } };
    service = crearService(mockTx);
  });

  it('devuelve el plano guardado', async () => {
    mockTx.restaurante.findUnique.mockResolvedValue({
      tenantId: TENANT_ID,
      plano: PLANO,
    });

    await expect(
      service.obtenerPlano(TENANT_ID, RESTAURANTE_ID),
    ).resolves.toEqual(PLANO);
  });

  it('devuelve un plano vacío si el restaurante nunca guardó uno (layout de HU-016)', async () => {
    mockTx.restaurante.findUnique.mockResolvedValue({
      tenantId: TENANT_ID,
      plano: null,
    });

    await expect(
      service.obtenerPlano(TENANT_ID, RESTAURANTE_ID),
    ).resolves.toEqual(PLANO_VACIO);
  });

  it('404 si el restaurante no existe o es de otro tenant', async () => {
    mockTx.restaurante.findUnique.mockResolvedValueOnce(null);
    mockTx.restaurante.findUnique.mockResolvedValueOnce({
      tenantId: TENANT_ID_AJENO,
      plano: PLANO,
    });

    await expect(
      service.obtenerPlano(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.obtenerPlano(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow(NotFoundException);
  });
});
