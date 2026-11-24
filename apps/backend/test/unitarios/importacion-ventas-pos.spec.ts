import { ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PosMockAdapter } from '../../src/pos/pos-mock.adapter';
import { PosHttpAdapter } from '../../src/pos/pos-http.adapter';
import {
  PosNoDisponibleError,
  PosRechazoError,
  VentaDelPos,
  VentaPos,
} from '../../src/pos/pos.adapter';
import {
  ImportacionVentasPosService,
  LOTE_IMPORTACION_POS,
  PRIMERA_IMPORTACION_MS,
} from '../../src/pos/importacion-ventas-pos.service';
import { SimularVentaPosDto } from '../../src/pos/dto/sincronizacion-pos.dto';

// HU-011 (BL-489): ventas hechas en el POS del local, traídas al dashboard.

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTRO_TENANT = '22222222-2222-4222-8222-222222222222';
const AHORA = new Date('2026-11-09T15:30:00.000Z');

const VENTA_BISTROLINK: VentaPos = {
  referencia: 'pedido-1',
  fecha: '2026-11-09T15:00:00.000Z',
  moneda: 'UYU',
  total: 590,
  medioPago: 'EFECTIVO',
  mesa: 4,
  lineas: [],
};

function ventaDelPos(extra: Partial<VentaDelPos> = {}): VentaDelPos {
  return {
    idPos: 'POS-1',
    referencia: null,
    fecha: '2026-11-09T14:10:00.000Z',
    total: 350,
    medioPago: 'EFECTIVO',
    anulada: false,
    actualizadaEn: '2026-11-09T14:10:00.000Z',
    ...extra,
  };
}

describe('PosMockAdapter: ventas propias (BL-489)', () => {
  it('lista las del establecimiento y las de BistroLink, por fecha de cambio', async () => {
    const pos = new PosMockAdapter();
    await pos.registrarVenta(VENTA_BISTROLINK);
    const propia = pos.simularVentaPropia(TENANT_ID, {
      total: 350,
      medioPago: 'CREDITO',
      fecha: new Date('2026-11-09T14:00:00.000Z'),
    });
    pos.simularVentaPropia(OTRO_TENANT, { total: 99, medioPago: 'EFECTIVO' });

    const ventas = await pos.listarVentas({
      establecimiento: TENANT_ID,
      desde: new Date(0),
      limite: 10,
    });

    expect(ventas).toHaveLength(2);
    expect(ventas[0]).toMatchObject({
      referencia: 'pedido-1',
      total: 590,
      anulada: false,
    });
    expect(ventas[1]).toEqual({
      idPos: propia.idPos,
      referencia: null,
      fecha: '2026-11-09T14:00:00.000Z',
      total: 350,
      medioPago: 'CREDITO',
      anulada: false,
      actualizadaEn: propia.actualizadaEn.toISOString(),
    });
  });

  it('respeta desde y limite; anular cambia la fecha de cambio una sola vez', async () => {
    const pos = new PosMockAdapter();
    const venta = pos.simularVentaPropia(TENANT_ID, {
      total: 100,
      medioPago: 'DEBITO',
    });
    pos.simularVentaPropia(TENANT_ID, { total: 200, medioPago: 'DEBITO' });
    const futuro = new Date(Date.now() + 60_000);

    await expect(
      pos.listarVentas({
        establecimiento: TENANT_ID,
        desde: futuro,
        limite: 5,
      }),
    ).resolves.toEqual([]);
    await expect(
      pos.listarVentas({
        establecimiento: TENANT_ID,
        desde: new Date(0),
        limite: 1,
      }),
    ).resolves.toHaveLength(1);

    venta.actualizadaEn = new Date(0);
    await pos.anularVenta(venta.idPos);
    const anuladaEn = venta.actualizadaEn;
    expect(venta.anulada).toBe(true);
    expect(anuladaEn.getTime()).toBeGreaterThan(0);
    await pos.anularVenta(venta.idPos);
    expect(venta.actualizadaEn).toBe(anuladaEn);
  });

  it('fuera de línea: no lista ni simula', async () => {
    const pos = new PosMockAdapter(false);
    await expect(
      pos.listarVentas({
        establecimiento: TENANT_ID,
        desde: new Date(0),
        limite: 5,
      }),
    ).rejects.toThrow(PosNoDisponibleError);
    expect(() =>
      pos.simularVentaPropia(TENANT_ID, { total: 1, medioPago: 'EFECTIVO' }),
    ).toThrow(PosNoDisponibleError);
  });
});

describe('PosHttpAdapter.listarVentas (BL-489)', () => {
  let fetchMock: jest.SpyInstance;
  const respuesta = (status: number, cuerpo?: unknown) =>
    Promise.resolve(
      new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
        status,
      }),
    );
  const pos = () => new PosHttpAdapter('https://pos.ejemplo.uy/api', 't-pos');
  const consulta = {
    establecimiento: TENANT_ID,
    desde: new Date('2026-11-09T00:00:00.000Z'),
    limite: 100,
  };
  const DE_LA_API = {
    id: 123,
    referencia: null,
    fecha: '2026-11-09T14:10:00.000Z',
    total: '350.50',
    medioPago: 'EFECTIVO',
    anulada: false,
    actualizadaEn: '2026-11-09T14:10:00.000Z',
  };

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('hace un GET con el establecimiento, desde y limite, y normaliza la venta', async () => {
    fetchMock.mockReturnValueOnce(respuesta(200, { ventas: [DE_LA_API] }));

    await expect(pos().listarVentas(consulta)).resolves.toEqual([
      {
        idPos: '123',
        referencia: null,
        fecha: '2026-11-09T14:10:00.000Z',
        total: 350.5,
        medioPago: 'EFECTIVO',
        anulada: false,
        actualizadaEn: '2026-11-09T14:10:00.000Z',
      },
    ]);
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://pos.ejemplo.uy/api/ventas?establecimiento=${TENANT_ID}&desde=2026-11-09T00%3A00%3A00.000Z&limite=100`,
    );
    expect(opciones.method).toBe('GET');
    expect(opciones.body).toBeUndefined();
    expect(opciones.headers).toEqual({
      Authorization: 'Bearer t-pos',
      Accept: 'application/json',
    });
  });

  it('5xx: no disponible; 4xx: rechazo', async () => {
    fetchMock
      .mockReturnValueOnce(respuesta(503))
      .mockReturnValueOnce(respuesta(401));
    await expect(pos().listarVentas(consulta)).rejects.toThrow(
      new PosNoDisponibleError('El POS no pudo listar las ventas (HTTP 503)'),
    );
    await expect(pos().listarVentas(consulta)).rejects.toThrow(
      new PosRechazoError('El POS rechazó listar las ventas (HTTP 401)'),
    );
  });

  it('una respuesta sin la lista, o una venta incompleta, es un rechazo', async () => {
    fetchMock
      .mockReturnValueOnce(respuesta(200, { otra: [] }))
      .mockReturnValueOnce(
        respuesta(200, { ventas: [{ ...DE_LA_API, fecha: 'ayer' }] }),
      )
      .mockReturnValueOnce(respuesta(200, { ventas: [null] }))
      .mockReturnValueOnce(
        respuesta(200, { ventas: [{ ...DE_LA_API, referencia: 7 }] }),
      );
    await expect(pos().listarVentas(consulta)).rejects.toThrow(
      'El POS respondió las ventas en un formato desconocido',
    );
    for (let i = 0; i < 3; i++) {
      await expect(pos().listarVentas(consulta)).rejects.toThrow(
        'El POS respondió una venta con datos incompletos',
      );
    }
  });

  it('la referencia que falta cuenta como venta propia (null)', async () => {
    const sinReferencia: Partial<typeof DE_LA_API> = { ...DE_LA_API };
    delete sinReferencia.referencia;
    fetchMock.mockReturnValueOnce(respuesta(200, { ventas: [sinReferencia] }));
    const [venta] = await pos().listarVentas(consulta);
    expect(venta.referencia).toBeNull();
  });
});

describe('ImportacionVentasPosService (BL-489)', () => {
  let tx: {
    restaurante: { findUnique: jest.Mock };
    ventaPosImportada: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      aggregate: jest.Mock;
      count: jest.Mock;
    };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let resumenVentas: { recalcularVentana: jest.Mock };
  let pos: { nombre: string; listarVentas: jest.Mock };
  let service: ImportacionVentasPosService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    tx = {
      restaurante: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ posSincronizacionHabilitada: true }),
      },
      ventaPosImportada: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn(),
        count: jest.fn(),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_t: string, fn: (t: unknown) => unknown) =>
        fn(tx),
      ),
    };
    resumenVentas = { recalcularVentana: jest.fn().mockResolvedValue({}) };
    pos = { nombre: 'http', listarVentas: jest.fn().mockResolvedValue([]) };
    service = new ImportacionVentasPosService(
      tenantPrisma as any,
      resumenVentas as any,
      pos as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('importarTenant', () => {
    it('la primera vez pide el último día; guarda las propias y omite las de BistroLink', async () => {
      pos.listarVentas.mockResolvedValue([
        ventaDelPos(),
        ventaDelPos({ idPos: 'POS-2', referencia: 'pedido-9' }),
      ]);

      await expect(service.importarTenant(TENANT_ID, AHORA)).resolves.toEqual({
        recibidas: 2,
        nuevas: 1,
        actualizadas: 0,
        omitidas: 1,
      });

      expect(pos.listarVentas).toHaveBeenCalledWith({
        establecimiento: TENANT_ID,
        desde: new Date(AHORA.getTime() - PRIMERA_IMPORTACION_MS),
        limite: LOTE_IMPORTACION_POS,
      });
      expect(tx.ventaPosImportada.create).toHaveBeenCalledTimes(1);
      expect(tx.ventaPosImportada.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          idPos: 'POS-1',
          vendidaEn: new Date('2026-11-09T14:10:00.000Z'),
          total: new Prisma.Decimal('350.00'),
          medioPago: 'EFECTIVO',
          anulada: false,
          actualizadaEnPos: new Date('2026-11-09T14:10:00.000Z'),
        },
      });
      // Solo la hora de la venta: 14:00 a 15:00.
      expect(resumenVentas.recalcularVentana).toHaveBeenCalledWith(TENANT_ID, {
        desde: new Date('2026-11-09T14:00:00.000Z'),
        hasta: new Date('2026-11-09T15:00:00.000Z'),
      });
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID, nuevas: 1 }),
      );
    });

    it('sigue desde la última venta importada; una anulación actualiza y recalcula su hora', async () => {
      const ultima = new Date('2026-11-09T13:00:00.000Z');
      tx.ventaPosImportada.findFirst.mockResolvedValue({
        actualizadaEnPos: ultima,
      });
      tx.ventaPosImportada.findMany.mockResolvedValue([
        {
          idPos: 'POS-1',
          vendidaEn: new Date('2026-11-09T11:20:00.000Z'),
          total: new Prisma.Decimal('350.00'),
          medioPago: 'EFECTIVO',
          anulada: false,
        },
      ]);
      pos.listarVentas.mockResolvedValue([
        ventaDelPos({
          fecha: '2026-11-09T11:20:00.000Z',
          anulada: true,
          actualizadaEn: '2026-11-09T14:00:00.000Z',
        }),
      ]);

      await expect(service.importarTenant(TENANT_ID, AHORA)).resolves.toEqual({
        recibidas: 1,
        nuevas: 0,
        actualizadas: 1,
        omitidas: 0,
      });
      expect(pos.listarVentas.mock.calls[0][0].desde).toBe(ultima);
      expect(tx.ventaPosImportada.update).toHaveBeenCalledWith({
        where: { tenantId_idPos: { tenantId: TENANT_ID, idPos: 'POS-1' } },
        data: expect.objectContaining({ anulada: true }),
      });
      expect(resumenVentas.recalcularVentana).toHaveBeenCalledWith(TENANT_ID, {
        desde: new Date('2026-11-09T11:00:00.000Z'),
        hasta: new Date('2026-11-09T12:00:00.000Z'),
      });
    });

    it('una venta repetida sin cambios no cuenta ni recalcula (desde es inclusivo)', async () => {
      tx.ventaPosImportada.findMany.mockResolvedValue([
        {
          idPos: 'POS-1',
          vendidaEn: new Date('2026-11-09T14:10:00.000Z'),
          total: new Prisma.Decimal('350.00'),
          medioPago: 'EFECTIVO',
          anulada: false,
        },
      ]);
      pos.listarVentas.mockResolvedValue([ventaDelPos()]);

      await expect(service.importarTenant(TENANT_ID, AHORA)).resolves.toEqual({
        recibidas: 1,
        nuevas: 0,
        actualizadas: 0,
        omitidas: 0,
      });
      expect(tx.ventaPosImportada.update).toHaveBeenCalledTimes(1);
      expect(resumenVentas.recalcularVentana).not.toHaveBeenCalled();
      expect(Logger.prototype.log).not.toHaveBeenCalled();
    });

    it('con un lote completo pide la página siguiente desde la última; se corta si no avanza', async () => {
      const lote = (minuto: number) =>
        Array.from({ length: LOTE_IMPORTACION_POS }, (_, i) =>
          ventaDelPos({
            idPos: `POS-${minuto}-${i}`,
            referencia: 'pedido',
            actualizadaEn: `2026-11-09T14:${String(minuto).padStart(2, '0')}:00.000Z`,
          }),
        );
      pos.listarVentas
        .mockResolvedValueOnce(lote(1))
        .mockResolvedValueOnce(lote(1));

      const r = await service.importarTenant(TENANT_ID, AHORA);

      expect(pos.listarVentas).toHaveBeenCalledTimes(2);
      expect(pos.listarVentas.mock.calls[1][0].desde).toEqual(
        new Date('2026-11-09T14:01:00.000Z'),
      );
      expect(r.omitidas).toBe(2 * LOTE_IMPORTACION_POS);
    });

    it('como mucho 10 consultas por corrida', async () => {
      let minuto = 0;
      pos.listarVentas.mockImplementation(() => {
        minuto++;
        return Promise.resolve(
          Array.from({ length: LOTE_IMPORTACION_POS }, () =>
            ventaDelPos({
              referencia: 'pedido',
              actualizadaEn: new Date(
                AHORA.getTime() + minuto * 60_000,
              ).toISOString(),
            }),
          ),
        );
      });
      await service.importarTenant(TENANT_ID, AHORA);
      expect(pos.listarVentas).toHaveBeenCalledTimes(10);
    });

    it('sin POS o con la sincronización apagada no consulta nada', async () => {
      const sinPos = new ImportacionVentasPosService(
        tenantPrisma as any,
        resumenVentas as any,
      );
      await expect(sinPos.importarTenant(TENANT_ID)).resolves.toEqual({
        recibidas: 0,
        nuevas: 0,
        actualizadas: 0,
        omitidas: 0,
      });
      tx.restaurante.findUnique.mockResolvedValue(null);
      await service.importarTenant(TENANT_ID);
      expect(pos.listarVentas).not.toHaveBeenCalled();
    });

    it('si el POS no responde, lanza (el job lo reintenta)', async () => {
      pos.listarVentas.mockRejectedValue(new PosNoDisponibleError());
      await expect(service.importarTenant(TENANT_ID)).rejects.toThrow(
        PosNoDisponibleError,
      );
    });

    it('recorta el medio de pago a 30 caracteres', async () => {
      pos.listarVentas.mockResolvedValue([
        ventaDelPos({ medioPago: 'X'.repeat(40) }),
      ]);
      await service.importarTenant(TENANT_ID, AHORA);
      expect(tx.ventaPosImportada.create.mock.calls[0][0].data.medioPago).toBe(
        'X'.repeat(30),
      );
    });
  });

  describe('importarAhora y simularVenta', () => {
    it('importarAhora: 409 sin POS, con la sincronización apagada o con el POS caído', async () => {
      const sinPos = new ImportacionVentasPosService(
        tenantPrisma as any,
        resumenVentas as any,
      );
      await expect(sinPos.importarAhora(TENANT_ID)).rejects.toThrow(
        'La API no tiene un POS configurado',
      );

      tx.restaurante.findUnique.mockResolvedValueOnce({
        posSincronizacionHabilitada: false,
      });
      await expect(service.importarAhora(TENANT_ID)).rejects.toThrow(
        'Activá la sincronización con el POS para traer las ventas',
      );

      pos.listarVentas.mockRejectedValueOnce(
        new PosNoDisponibleError('El POS no respondió: TimeoutError'),
      );
      await expect(service.importarAhora(TENANT_ID)).rejects.toThrow(
        new ConflictException(
          'No se pudieron traer las ventas: El POS no respondió: TimeoutError',
        ),
      );

      pos.listarVentas.mockRejectedValueOnce(new Error('otra cosa'));
      await expect(service.importarAhora(TENANT_ID)).rejects.toThrow(
        'otra cosa',
      );

      await expect(service.importarAhora(TENANT_ID)).resolves.toEqual({
        recibidas: 0,
        nuevas: 0,
        actualizadas: 0,
        omitidas: 0,
      });
    });

    it('simularVenta: solo con el POS de prueba; la crea y la trae', async () => {
      await expect(
        service.simularVenta(TENANT_ID, { total: 350, medioPago: 'EFECTIVO' }),
      ).rejects.toThrow('Solo se pueden simular ventas con el POS de prueba');

      const mock = new PosMockAdapter();
      const conMock = new ImportacionVentasPosService(
        tenantPrisma as any,
        resumenVentas as any,
        mock,
      );
      const r = await conMock.simularVenta(TENANT_ID, {
        total: 350,
        medioPago: 'CREDITO',
      });

      expect(r).toMatchObject({ recibidas: 1, nuevas: 1, omitidas: 0 });
      expect(r.idPos).toMatch(/^MOCK-/);
      expect(tx.ventaPosImportada.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          idPos: r.idPos,
          total: new Prisma.Decimal('350.00'),
          medioPago: 'CREDITO',
        }),
      });
    });
  });

  it('resumen: ventas que cuentan, anuladas, total y la última', async () => {
    tx.ventaPosImportada.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { total: new Prisma.Decimal('1050.5') },
    });
    tx.ventaPosImportada.count.mockResolvedValue(1);
    tx.ventaPosImportada.findFirst.mockResolvedValue({
      vendidaEn: new Date('2026-11-09T14:10:00.000Z'),
    });

    await expect(service.resumen(TENANT_ID)).resolves.toEqual({
      ventas: 3,
      anuladas: 1,
      total: 1050.5,
      ultimaVentaEn: '2026-11-09T14:10:00.000Z',
    });
    expect(tx.ventaPosImportada.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_ID, anulada: false },
      }),
    );

    tx.ventaPosImportada.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { total: null },
    });
    tx.ventaPosImportada.count.mockResolvedValue(0);
    tx.ventaPosImportada.findFirst.mockResolvedValue(null);
    await expect(service.resumen(TENANT_ID)).resolves.toEqual({
      ventas: 0,
      anuladas: 0,
      total: 0,
      ultimaVentaEn: null,
    });
  });
});

describe('SimularVentaPosDto (BL-489)', () => {
  const errores = async (datos: Record<string, unknown>) =>
    (await validate(plainToInstance(SimularVentaPosDto, datos))).flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );

  it('total de 1 a 100000 con hasta 2 decimales y un medio conocido', async () => {
    expect(await errores({ total: '350.5', medioPago: 'DEBITO' })).toEqual([]);
    expect(await errores({ total: 0.5, medioPago: 'EFECTIVO' })).toEqual([
      'total debe ser 1 o más',
    ]);
    expect(await errores({ total: 100001, medioPago: 'EFECTIVO' })).toEqual([
      'total debe ser 100000 o menos',
    ]);
    expect(await errores({ total: 10.123, medioPago: 'EFECTIVO' })).toEqual([
      'total debe ser un número con hasta 2 decimales',
    ]);
    expect(await errores({ total: 10, medioPago: 'CHEQUE' })).toEqual([
      'medioPago debe ser uno de: EFECTIVO, CREDITO, DEBITO',
    ]);
  });
});
