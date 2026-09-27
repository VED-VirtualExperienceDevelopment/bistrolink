import { ConflictException, NotFoundException } from '@nestjs/common';
import { MesaEstado, Prisma } from '@prisma/client';
import { MesasService } from '../../src/mesas/mesas.service';

/**
 * HU-016 — casos que complementan mesas.service.spec.ts.
 * Pensados para agregarse al final de ese archivo (reusan las mismas
 * constantes); están separados acá solo para revisarlos por aparte.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const RESTAURANTE_ID_AJENO = '44444444-4444-4444-4444-444444444444';
const MESA_ID = '33333333-3333-3333-3333-333333333333';

function crearErrorP2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '0.0.0',
  });
}

function armarServicio() {
  const mockTx = {
    restaurante: {
      findUnique: jest.fn().mockResolvedValue({ tenantId: TENANT_ID }),
    },
    mesa: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const mockTenantPrisma = {
    runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
  };
  const mockKdsGateway = {
    emitirLlamado: jest.fn(),
    emitirEstadoMesa: jest.fn(),
  };
  const service = new MesasService(
    mockTenantPrisma as any,
    mockKdsGateway as any,
  );
  return { service, mockTx };
}

describe('HU-016: serializa y deserializa el JSON del layout sin pérdida de datos', () => {
  // Valores elegidos para detectar pérdidas típicas al pasar por JSON/JSONB:
  // decimales, negativos (mesa arrastrada fuera del origen), extremos de
  // rotación y las tres formas del catálogo.
  const MESAS_ENTRADA = [
    {
      numero: 1,
      x: 12.75,
      y: -3.5,
      forma: 'CIRCULO' as const,
      ancho: 80,
      alto: 80,
      rotacion: 0,
    },
    {
      numero: 2,
      x: 0,
      y: 0,
      forma: 'CUADRADO' as const,
      ancho: 1,
      alto: 1,
      rotacion: 359,
    },
    {
      numero: 3,
      x: 1024.125,
      y: 768.5,
      forma: 'RECTANGULO' as const,
      ancho: 160.5,
      alto: 60,
      rotacion: 45.5,
    },
  ];

  it('lo que se guarda con guardarLayout vuelve idéntico al leerlo con obtenerLayout', async () => {
    const { service, mockTx } = armarServicio();

    // "Base de datos" en memoria: create persiste el layout pasándolo por
    // JSON.stringify/parse, igual que un campo Json de Prisma sobre JSONB.
    const persistidas: any[] = [];
    mockTx.mesa.create.mockImplementation(async ({ data }: any) => {
      const fila = {
        id: `mesa-${data.numero}`,
        numero: data.numero,
        estado: data.estado,
        layout: JSON.parse(JSON.stringify(data.layout)),
      };
      persistidas.push(fila);
      return fila;
    });
    mockTx.mesa.findMany.mockImplementation(async () => persistidas);

    await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, MESAS_ENTRADA);
    const leidas = await service.obtenerLayout(TENANT_ID, RESTAURANTE_ID);

    expect(leidas).toHaveLength(MESAS_ENTRADA.length);
    MESAS_ENTRADA.forEach(({ numero, ...layoutEsperado }, i) => {
      expect(leidas[i].numero).toBe(numero);
      expect(leidas[i].layout).toStrictEqual(layoutEsperado);
    });
  });

  it('el JSON persistido no duplica id ni numero (viven como columnas, no dentro del layout)', async () => {
    const { service, mockTx } = armarServicio();
    mockTx.mesa.findUnique.mockResolvedValue({
      id: MESA_ID,
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
    });
    mockTx.mesa.update.mockResolvedValue({});

    await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
      { id: MESA_ID, ...MESAS_ENTRADA[0] },
    ]);

    const { layout } = mockTx.mesa.update.mock.calls[0][0].data;
    expect(Object.keys(layout).sort()).toEqual([
      'alto',
      'ancho',
      'forma',
      'rotacion',
      'x',
      'y',
    ]);
  });
});

describe('MesasService.guardarLayout — restaurante del tenant (HU-016, TC-I-033)', () => {
  const LAYOUT = {
    x: 10,
    y: 20,
    forma: 'CIRCULO' as const,
    ancho: 80,
    alto: 80,
    rotacion: 0,
  };

  it('rechaza con 404 y no crea nada si el restaurante es de otro tenant', async () => {
    const { service, mockTx } = armarServicio();
    mockTx.restaurante.findUnique.mockResolvedValue({
      tenantId: 'otro-tenant',
    });

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID_AJENO, [
        { numero: 1, ...LAYOUT },
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.mesa.create).not.toHaveBeenCalled();
    expect(mockTx.mesa.update).not.toHaveBeenCalled();
  });

  it('rechaza con 404 si el restaurante no existe (o RLS lo oculta)', async () => {
    const { service, mockTx } = armarServicio();
    mockTx.restaurante.findUnique.mockResolvedValue(null);

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID_AJENO, [
        { numero: 1, ...LAYOUT },
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.mesa.create).not.toHaveBeenCalled();
  });
});

describe('MesasService.guardarLayout — casos adicionales (HU-016)', () => {
  const LAYOUT = {
    x: 10,
    y: 20,
    forma: 'CIRCULO' as const,
    ancho: 80,
    alto: 80,
    rotacion: 0,
  };

  it('rechaza con 404 si se manda un id que no existe (findUnique devuelve null)', async () => {
    const { service, mockTx } = armarServicio();
    mockTx.mesa.findUnique.mockResolvedValue(null);

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
        { id: MESA_ID, numero: 1, ...LAYOUT },
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.mesa.update).not.toHaveBeenCalled();
  });

  it('rechaza con 404 si la mesa es del mismo tenant pero de OTRO restaurante', async () => {
    const { service, mockTx } = armarServicio();
    mockTx.mesa.findUnique.mockResolvedValue({
      id: MESA_ID,
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID_AJENO,
    });

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
        { id: MESA_ID, numero: 1, ...LAYOUT },
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.mesa.update).not.toHaveBeenCalled();
  });

  it('guardado mixto: actualiza las existentes y crea las nuevas, devolviendo el resultado en el mismo orden', async () => {
    const { service, mockTx } = armarServicio();
    mockTx.mesa.findUnique.mockResolvedValue({
      id: MESA_ID,
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
    });
    mockTx.mesa.update.mockResolvedValue({ id: MESA_ID, numero: 1 });
    mockTx.mesa.create.mockResolvedValue({ id: 'nueva', numero: 2 });

    const resultado = await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
      { id: MESA_ID, numero: 1, ...LAYOUT },
      { numero: 2, ...LAYOUT },
    ]);

    expect(mockTx.mesa.update).toHaveBeenCalledTimes(1);
    expect(mockTx.mesa.create).toHaveBeenCalledTimes(1);
    expect(resultado.map((m: any) => m.numero)).toEqual([1, 2]);
  });

  it('si falla una mesa a mitad del guardado, corta ahí y propaga el error (el rollback lo hace la transacción)', async () => {
    const { service, mockTx } = armarServicio();
    mockTx.mesa.create
      .mockResolvedValueOnce({
        id: 'mesa-1',
        numero: 1,
        estado: MesaEstado.LIBRE,
      })
      .mockRejectedValueOnce(crearErrorP2002());

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
        { numero: 1, ...LAYOUT },
        { numero: 1, ...LAYOUT }, // número repetido dentro del mismo guardado
        { numero: 3, ...LAYOUT },
      ]),
    ).rejects.toThrow(ConflictException);
    // La 3ra mesa nunca se intenta crear.
    expect(mockTx.mesa.create).toHaveBeenCalledTimes(2);
  });
});
