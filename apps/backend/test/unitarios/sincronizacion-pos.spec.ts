import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SincronizacionPosService,
  TAMANO_PAGINA_POS,
  ventaDelPedido,
} from '../../src/pos/sincronizacion-pos.service';
import { SincronizacionPosJob } from '../../src/pos/sincronizacion-pos.job';
import { SincronizacionPosController } from '../../src/pos/sincronizacion-pos.controller';
import { PosMockAdapter } from '../../src/pos/pos-mock.adapter';
import { PosRechazoError } from '../../src/pos/pos.adapter';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CambiarSincronizacionPosDto,
  ConsultarSincronizacionesPosDto,
} from '../../src/pos/dto/sincronizacion-pos.dto';

// HU-011 (BL-488): bandeja de salida hacia el POS del local.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = 'a1b2c3d4-0000-0000-0000-000000000001';
const FILA_ID = 'f0f0f0f0-0000-0000-0000-000000000001';

const pedidoDe = (extra: Record<string, unknown> = {}) => ({
  id: PEDIDO_ID,
  encoladoEn: new Date('2026-11-08T15:00:00Z'),
  createdAt: new Date('2026-11-08T14:58:00Z'),
  mesa: { numero: 4, esVirtual: false },
  lineas: [
    {
      nombreSnapshot: 'Milanesa',
      cantidad: 2,
      precioUnitarioSnapshot: new Prisma.Decimal('295.50'),
      subtotal: new Prisma.Decimal('591.00'),
    },
    {
      nombreSnapshot: 'Agua',
      cantidad: 1,
      precioUnitarioSnapshot: new Prisma.Decimal('90'),
      subtotal: new Prisma.Decimal('90'),
    },
  ],
  pagos: [{ medioPago: 'EFECTIVO' }],
  sincronizacionesPos: [] as { posRef: string | null }[],
  ...extra,
});

const filaDe = (extra: Record<string, unknown> = {}) => ({
  id: FILA_ID,
  tipo: 'VENTA',
  estado: 'PENDIENTE',
  intentos: 0,
  pedidoId: PEDIDO_ID,
  pedido: pedidoDe(),
  ...extra,
});

function crearTx() {
  return {
    pedido: { findUnique: jest.fn() },
    restaurante: { findUnique: jest.fn(), update: jest.fn() },
    sincronizacionPos: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

describe('ventaDelPedido (BL-488)', () => {
  it('arma la venta con el id del pedido como referencia, sin datos personales', () => {
    expect(ventaDelPedido(pedidoDe() as any)).toEqual({
      referencia: PEDIDO_ID,
      fecha: '2026-11-08T15:00:00.000Z',
      moneda: 'UYU',
      total: 681,
      medioPago: 'EFECTIVO',
      mesa: 4,
      lineas: [
        {
          descripcion: 'Milanesa',
          cantidad: 2,
          precioUnitario: 295.5,
          subtotal: 591,
        },
        { descripcion: 'Agua', cantidad: 1, precioUnitario: 90, subtotal: 90 },
      ],
    });
  });

  it('para retirar (mesa virtual): sin mesa; sin encolado ni pago: fecha de creación y medio desconocido', () => {
    const venta = ventaDelPedido(
      pedidoDe({
        encoladoEn: null,
        mesa: { numero: 0, esVirtual: true },
        pagos: [],
      }) as any,
    );
    expect(venta.mesa).toBeNull();
    expect(venta.fecha).toBe('2026-11-08T14:58:00.000Z');
    expect(venta.medioPago).toBe('DESCONOCIDO');
  });
});

describe('SincronizacionPosService (BL-488)', () => {
  const entornoOriginal = process.env;
  let tx: ReturnType<typeof crearTx>;
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let auditLog: { registrarEnTx: jest.Mock };
  let pos: PosMockAdapter;
  let service: SincronizacionPosService;

  beforeEach(() => {
    process.env = { ...entornoOriginal, NODE_ENV: 'test' };
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    tx = crearTx();
    tenantPrisma = {
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    auditLog = { registrarEnTx: jest.fn() };
    pos = new PosMockAdapter();
    service = new SincronizacionPosService(
      tenantPrisma as any,
      auditLog as any,
      pos,
    );
  });

  afterEach(() => {
    process.env = entornoOriginal;
    jest.restoreAllMocks();
  });

  describe('encolarVentaEnTx', () => {
    it('con el envío activado, encola la venta (una por pedido)', async () => {
      tx.pedido.findUnique.mockResolvedValue({
        restaurante: { posSincronizacionHabilitada: true },
      });

      await expect(
        service.encolarVentaEnTx(tx as any, TENANT_ID, PEDIDO_ID),
      ).resolves.toBe(true);
      expect(tx.sincronizacionPos.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: TENANT_ID, pedidoId: PEDIDO_ID, tipo: 'VENTA' }],
        skipDuplicates: true,
      });
    });

    it('con el envío desactivado, o sin pedido, no encola', async () => {
      tx.pedido.findUnique
        .mockResolvedValueOnce({
          restaurante: { posSincronizacionHabilitada: false },
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.encolarVentaEnTx(tx as any, TENANT_ID, PEDIDO_ID),
      ).resolves.toBe(false);
      await expect(
        service.encolarVentaEnTx(tx as any, TENANT_ID, PEDIDO_ID),
      ).resolves.toBe(false);
      expect(tx.sincronizacionPos.createMany).not.toHaveBeenCalled();
    });

    it('sin POS configurado en la API, no encola ni lee nada', async () => {
      const sinPos = new SincronizacionPosService(
        tenantPrisma as any,
        auditLog as any,
      );
      expect(sinPos.configurado()).toBe(false);
      expect(service.configurado()).toBe(true);
      await expect(
        sinPos.encolarVentaEnTx(tx as any, TENANT_ID, PEDIDO_ID),
      ).resolves.toBe(false);
      expect(tx.pedido.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('encolarAnulacionEnTx', () => {
    it('venta ya en el POS: encola la anulación', async () => {
      tx.sincronizacionPos.findUnique.mockResolvedValue({
        id: FILA_ID,
        estado: 'ENVIADA',
      });

      await expect(
        service.encolarAnulacionEnTx(tx as any, TENANT_ID, PEDIDO_ID),
      ).resolves.toBe(true);
      expect(tx.sincronizacionPos.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: TENANT_ID, pedidoId: PEDIDO_ID, tipo: 'ANULACION' }],
        skipDuplicates: true,
      });
    });

    it.each(['PENDIENTE', 'ERROR'])(
      'venta %s (no llegó al POS): se descarta, no hay nada que anular',
      async (estado) => {
        tx.sincronizacionPos.findUnique.mockResolvedValue({
          id: FILA_ID,
          estado,
        });

        await expect(
          service.encolarAnulacionEnTx(tx as any, TENANT_ID, PEDIDO_ID),
        ).resolves.toBe(false);
        expect(tx.sincronizacionPos.update).toHaveBeenCalledWith({
          where: { id: FILA_ID },
          data: { estado: 'DESCARTADA' },
        });
        expect(tx.sincronizacionPos.createMany).not.toHaveBeenCalled();
      },
    );

    it('sin venta encolada (local sin POS) o ya descartada: nada', async () => {
      tx.sincronizacionPos.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: FILA_ID, estado: 'DESCARTADA' });

      await service.encolarAnulacionEnTx(tx as any, TENANT_ID, PEDIDO_ID);
      await service.encolarAnulacionEnTx(tx as any, TENANT_ID, PEDIDO_ID);

      expect(tx.sincronizacionPos.update).not.toHaveBeenCalled();
      expect(tx.sincronizacionPos.createMany).not.toHaveBeenCalled();
    });
  });

  describe('enviar', () => {
    it('venta: la registra en el POS y la marca ENVIADA con el id del POS', async () => {
      tx.sincronizacionPos.findUnique.mockResolvedValue(filaDe());

      await expect(service.enviar(TENANT_ID, FILA_ID)).resolves.toBe('ENVIADA');

      const [registrada] = pos.ventasRegistradas();
      expect(registrada.venta.referencia).toBe(PEDIDO_ID);
      expect(tx.sincronizacionPos.updateMany).toHaveBeenCalledWith({
        where: { id: FILA_ID, estado: { in: ['PENDIENTE', 'ERROR'] } },
        data: expect.objectContaining({
          estado: 'ENVIADA',
          intentos: 1,
          ultimoError: null,
          posRef: registrada.idPos,
          enviadaEn: expect.any(Date),
        }),
      });
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.objectContaining({
          pedidoId: PEDIDO_ID,
          tipo: 'VENTA',
          resultado: 'ENVIADA',
          adaptador: 'mock',
        }),
      );
    });

    it('anulación: anula en el POS la venta del pedido', async () => {
      const { idPos } = await pos.registrarVenta(
        ventaDelPedido(pedidoDe() as any),
      );
      tx.sincronizacionPos.findUnique.mockResolvedValue(
        filaDe({
          tipo: 'ANULACION',
          pedido: pedidoDe({ sincronizacionesPos: [{ posRef: idPos }] }),
        }),
      );

      await expect(service.enviar(TENANT_ID, FILA_ID)).resolves.toBe('ENVIADA');
      expect(pos.ventasRegistradas()[0].anulada).toBe(true);
      // Al anular no hay id nuevo del POS.
      expect(
        tx.sincronizacionPos.updateMany.mock.calls[0][0].data,
      ).not.toHaveProperty('posRef');
    });

    it('anulación sin la venta en el POS: ERROR (no se reintenta sola)', async () => {
      tx.sincronizacionPos.findUnique.mockResolvedValue(
        filaDe({ tipo: 'ANULACION' }),
      );

      await expect(service.enviar(TENANT_ID, FILA_ID)).resolves.toBe('ERROR');
      expect(tx.sincronizacionPos.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            estado: 'ERROR',
            ultimoError: 'La venta de este pedido no está en el POS',
          }),
        }),
      );
    });

    it('POS caído: sigue PENDIENTE con el intento y el motivo, sin tocar el pedido', async () => {
      pos.disponible = false;
      tx.sincronizacionPos.findUnique.mockResolvedValue(
        filaDe({ intentos: 2 }),
      );

      await expect(service.enviar(TENANT_ID, FILA_ID)).resolves.toBe(
        'PENDIENTE',
      );
      expect(tx.sincronizacionPos.updateMany).toHaveBeenCalledWith({
        where: { id: FILA_ID, estado: { in: ['PENDIENTE', 'ERROR'] } },
        data: {
          estado: 'PENDIENTE',
          intentos: 3,
          ultimoIntentoEn: expect.any(Date),
          ultimoError: 'El POS de prueba está fuera de línea',
        },
      });
      expect(tx.pedido.findUnique).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({ resultado: 'PENDIENTE', intentos: 3 }),
      );
    });

    it('POS caído en el último intento (POS_SINCRONIZACION_MAX_INTENTOS): ERROR', async () => {
      process.env.POS_SINCRONIZACION_MAX_INTENTOS = '3';
      const conTope = new SincronizacionPosService(
        tenantPrisma as any,
        auditLog as any,
        pos,
      );
      pos.disponible = false;
      tx.sincronizacionPos.findUnique.mockResolvedValue(
        filaDe({ intentos: 2 }),
      );

      await expect(conTope.enviar(TENANT_ID, FILA_ID)).resolves.toBe('ERROR');
    });

    it('el POS la rechazó: ERROR, con el motivo recortado a una línea y 200 caracteres', async () => {
      jest
        .spyOn(pos, 'registrarVenta')
        .mockRejectedValue(new PosRechazoError(`HTTP 422\n${'x'.repeat(300)}`));
      tx.sincronizacionPos.findUnique.mockResolvedValue(filaDe());

      await expect(service.enviar(TENANT_ID, FILA_ID)).resolves.toBe('ERROR');
      const motivo =
        tx.sincronizacionPos.updateMany.mock.calls[0][0].data.ultimoError;
      expect(motivo).toHaveLength(200);
      expect(motivo.startsWith('HTTP 422 x')).toBe(true);
    });

    it('un error que no es un Error: motivo genérico', async () => {
      jest.spyOn(pos, 'registrarVenta').mockRejectedValue('raro');
      tx.sincronizacionPos.findUnique.mockResolvedValue(filaDe());

      await service.enviar(TENANT_ID, FILA_ID);
      expect(
        tx.sincronizacionPos.updateMany.mock.calls[0][0].data.ultimoError,
      ).toBe('Error desconocido del POS');
    });

    it('ya ENVIADA o DESCARTADA: no la vuelve a mandar', async () => {
      const registrar = jest.spyOn(pos, 'registrarVenta');
      tx.sincronizacionPos.findUnique
        .mockResolvedValueOnce(filaDe({ estado: 'ENVIADA' }))
        .mockResolvedValueOnce(filaDe({ estado: 'DESCARTADA' }));

      await expect(service.enviar(TENANT_ID, FILA_ID)).resolves.toBe('ENVIADA');
      await expect(service.enviar(TENANT_ID, FILA_ID)).resolves.toBe(
        'DESCARTADA',
      );
      expect(registrar).not.toHaveBeenCalled();
    });

    it('sin fila o sin POS: null', async () => {
      tx.sincronizacionPos.findUnique.mockResolvedValue(null);
      await expect(service.enviar(TENANT_ID, FILA_ID)).resolves.toBeNull();

      const sinPos = new SincronizacionPosService(
        tenantPrisma as any,
        auditLog as any,
        null,
      );
      await expect(sinPos.enviar(TENANT_ID, FILA_ID)).resolves.toBeNull();
    });

    it('si el pedido se canceló mientras se mandaba (venta DESCARTADA), la marca ENVIADA y encola la anulación', async () => {
      tx.sincronizacionPos.findUnique
        .mockResolvedValueOnce(filaDe())
        .mockResolvedValueOnce({ estado: 'DESCARTADA' });
      tx.sincronizacionPos.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.enviar(TENANT_ID, FILA_ID)).resolves.toBe('ENVIADA');
      expect(tx.sincronizacionPos.update).toHaveBeenCalledWith({
        where: { id: FILA_ID },
        data: expect.objectContaining({ estado: 'ENVIADA' }),
      });
      expect(tx.sincronizacionPos.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: TENANT_ID, pedidoId: PEDIDO_ID, tipo: 'ANULACION' }],
        skipDuplicates: true,
      });
    });

    it('si otro envío ya la marcó ENVIADA, no encola ninguna anulación', async () => {
      tx.sincronizacionPos.findUnique
        .mockResolvedValueOnce(filaDe())
        .mockResolvedValueOnce({ estado: 'ENVIADA' });
      tx.sincronizacionPos.updateMany.mockResolvedValue({ count: 0 });

      await service.enviar(TENANT_ID, FILA_ID);
      expect(tx.sincronizacionPos.update).not.toHaveBeenCalled();
      expect(tx.sincronizacionPos.createMany).not.toHaveBeenCalled();
    });

    it('una anulación que otro envío ya marcó: no hace nada más', async () => {
      const { idPos } = await pos.registrarVenta(
        ventaDelPedido(pedidoDe() as any),
      );
      tx.sincronizacionPos.findUnique.mockResolvedValueOnce(
        filaDe({
          tipo: 'ANULACION',
          pedido: pedidoDe({ sincronizacionesPos: [{ posRef: idPos }] }),
        }),
      );
      tx.sincronizacionPos.updateMany.mockResolvedValue({ count: 0 });

      await service.enviar(TENANT_ID, FILA_ID);
      expect(tx.sincronizacionPos.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.sincronizacionPos.createMany).not.toHaveBeenCalled();
    });
  });

  describe('enviarEnSegundoPlano', () => {
    it('manda lo pendiente del pedido, de a uno (la venta antes que la anulación)', async () => {
      const enviar = jest.spyOn(service, 'enviar').mockResolvedValue('ENVIADA');
      tx.sincronizacionPos.findMany.mockResolvedValue([
        { id: 'venta' },
        { id: 'anulacion' },
      ]);

      service.enviarEnSegundoPlano(TENANT_ID, PEDIDO_ID);
      await new Promise((r) => setImmediate(r));

      expect(tx.sincronizacionPos.findMany).toHaveBeenCalledWith({
        where: { pedidoId: PEDIDO_ID, estado: 'PENDIENTE' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(enviar.mock.calls).toEqual([
        [TENANT_ID, 'venta'],
        [TENANT_ID, 'anulacion'],
      ]);
    });

    it('si no puede leer, queda en el log y no lanza', async () => {
      tx.sincronizacionPos.findMany.mockRejectedValue(new Error('sin base'));

      service.enviarEnSegundoPlano(TENANT_ID, PEDIDO_ID);
      await new Promise((r) => setImmediate(r));

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        `POS: no se pudo mandar lo pendiente del pedido ${PEDIDO_ID}: sin base`,
      );
    });

    it('sin POS no hace nada', () => {
      const sinPos = new SincronizacionPosService(
        tenantPrisma as any,
        auditLog as any,
      );
      sinPos.enviarEnSegundoPlano(TENANT_ID, PEDIDO_ID);
      expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
    });
  });

  describe('sincronizarTenant', () => {
    const ahora = new Date('2026-11-08T16:00:00Z');

    it('manda las PENDIENTES a las que les toca, hasta el lote, y cuenta el resultado', async () => {
      tx.sincronizacionPos.findMany.mockResolvedValue([
        // Recién encolada (10 s): todavía no le toca.
        {
          id: 'nueva',
          createdAt: new Date(ahora.getTime() - 10_000),
          intentos: 0,
          ultimoIntentoEn: null,
        },
        {
          id: 'a',
          createdAt: new Date('2026-11-08T15:00:00Z'),
          intentos: 0,
          ultimoIntentoEn: null,
        },
        {
          id: 'b',
          createdAt: new Date('2026-11-08T15:00:00Z'),
          intentos: 1,
          ultimoIntentoEn: new Date('2026-11-08T15:50:00Z'),
        },
        {
          id: 'c',
          createdAt: new Date('2026-11-08T15:00:00Z'),
          intentos: 1,
          ultimoIntentoEn: new Date('2026-11-08T15:50:00Z'),
        },
      ]);
      const enviar = jest
        .spyOn(service, 'enviar')
        .mockResolvedValueOnce('ENVIADA')
        .mockResolvedValueOnce('PENDIENTE');

      await expect(
        service.sincronizarTenant(TENANT_ID, { lote: 2 }, ahora),
      ).resolves.toEqual({ revisados: 2, enviados: 1, fallidos: 1 });
      expect(enviar.mock.calls.map((c) => c[1])).toEqual(['a', 'b']);
      expect(tx.sincronizacionPos.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { estado: 'PENDIENTE' },
          orderBy: { createdAt: 'asc' },
          take: 10,
        }),
      );
    });

    it('sin POS: nada', async () => {
      const sinPos = new SincronizacionPosService(
        tenantPrisma as any,
        auditLog as any,
      );
      await expect(
        sinPos.sincronizarTenant(TENANT_ID, { lote: 2 }),
      ).resolves.toEqual({ revisados: 0, enviados: 0, fallidos: 0 });
    });
  });

  describe('listar', () => {
    const fila = {
      id: FILA_ID,
      tipo: 'VENTA',
      estado: 'ENVIADA',
      pedidoId: PEDIDO_ID,
      posRef: 'MOCK-1',
      intentos: 1,
      ultimoError: null,
      ultimoIntentoEn: new Date('2026-11-08T15:00:01Z'),
      enviadaEn: new Date('2026-11-08T15:00:01Z'),
      createdAt: new Date('2026-11-08T15:00:00Z'),
      pedido: {
        mesa: { numero: 4, esVirtual: false },
        lineas: [
          { subtotal: new Prisma.Decimal('591') },
          { subtotal: new Prisma.Decimal('90.10') },
        ],
      },
    };

    it('de la más nueva a la más vieja, con el total del pedido y el estado del envío', async () => {
      tx.sincronizacionPos.findMany.mockResolvedValue([
        fila,
        {
          ...fila,
          id: 'otra',
          estado: 'PENDIENTE',
          posRef: null,
          ultimoIntentoEn: null,
          enviadaEn: null,
          pedido: { mesa: { numero: 0, esVirtual: true }, lineas: [] },
        },
      ]);
      tx.sincronizacionPos.count.mockResolvedValue(45);
      tx.restaurante.findUnique.mockResolvedValue({
        posSincronizacionHabilitada: true,
      });

      const pagina = await service.listar(TENANT_ID, {});

      expect(tx.sincronizacionPos.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: TAMANO_PAGINA_POS,
        }),
      );
      expect(pagina).toMatchObject({
        habilitada: true,
        adaptador: 'mock',
        pagina: 1,
        hayMas: true,
        total: 45,
      });
      expect(pagina.sincronizaciones[0]).toEqual({
        id: FILA_ID,
        tipo: 'VENTA',
        estado: 'ENVIADA',
        pedidoId: PEDIDO_ID,
        mesa: 4,
        total: 681.1,
        posRef: 'MOCK-1',
        intentos: 1,
        ultimoError: null,
        ultimoIntentoEn: '2026-11-08T15:00:01.000Z',
        enviadaEn: '2026-11-08T15:00:01.000Z',
        creadaEn: '2026-11-08T15:00:00.000Z',
      });
      expect(pagina.sincronizaciones[1]).toMatchObject({
        mesa: null,
        total: 0,
        ultimoIntentoEn: null,
        enviadaEn: null,
      });
    });

    it('filtra por estado y pagina; sin restaurante ni POS: desactivada y sin adaptador', async () => {
      const sinPos = new SincronizacionPosService(
        tenantPrisma as any,
        auditLog as any,
      );
      tx.sincronizacionPos.count.mockResolvedValue(25);
      tx.restaurante.findUnique.mockResolvedValue(null);

      const pagina = await sinPos.listar(TENANT_ID, {
        pagina: 2,
        estado: 'ERROR',
      });

      expect(tx.sincronizacionPos.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { estado: 'ERROR' },
          skip: TAMANO_PAGINA_POS,
        }),
      );
      expect(tx.sincronizacionPos.count).toHaveBeenCalledWith({
        where: { estado: 'ERROR' },
      });
      expect(pagina).toMatchObject({
        habilitada: false,
        adaptador: null,
        pagina: 2,
        hayMas: false,
      });
    });
  });

  describe('reintentar', () => {
    it('vuelve a mandar una con error, con los intentos en cero, y devuelve el resultado', async () => {
      tx.sincronizacionPos.findUnique.mockResolvedValue({ estado: 'ERROR' });
      tx.sincronizacionPos.findUniqueOrThrow.mockResolvedValue({
        estado: 'ENVIADA',
        ultimoError: null,
      });
      const enviar = jest.spyOn(service, 'enviar').mockResolvedValue('ENVIADA');

      await expect(service.reintentar(TENANT_ID, FILA_ID)).resolves.toEqual({
        id: FILA_ID,
        estado: 'ENVIADA',
        ultimoError: null,
      });
      expect(tx.sincronizacionPos.update).toHaveBeenCalledWith({
        where: { id: FILA_ID },
        data: { estado: 'PENDIENTE', intentos: 0 },
      });
      expect(enviar).toHaveBeenCalledWith(TENANT_ID, FILA_ID);
    });

    it('no existe: 404; ya enviada o descartada: 409', async () => {
      tx.sincronizacionPos.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ estado: 'ENVIADA' })
        .mockResolvedValueOnce({ estado: 'DESCARTADA' });

      await expect(service.reintentar(TENANT_ID, FILA_ID)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.reintentar(TENANT_ID, FILA_ID)).rejects.toThrow(
        'Ya está en el POS',
      );
      await expect(service.reintentar(TENANT_ID, FILA_ID)).rejects.toThrow(
        'El pedido se canceló antes de mandarse',
      );
    });

    it('sin POS en la API: 409', async () => {
      const sinPos = new SincronizacionPosService(
        tenantPrisma as any,
        auditLog as any,
      );
      await expect(sinPos.reintentar(TENANT_ID, FILA_ID)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('cambiarHabilitada', () => {
    it('activa el envío y lo deja en la auditoría con antes y después', async () => {
      tx.restaurante.findUnique.mockResolvedValue({
        posSincronizacionHabilitada: false,
      });

      await expect(
        service.cambiarHabilitada(TENANT_ID, 'admin-kc', true),
      ).resolves.toEqual({ habilitada: true });
      expect(tx.restaurante.update).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        data: { posSincronizacionHabilitada: true },
      });
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.ESTABLECIMIENTO_CONFIGURACION_MODIFICADA,
        tenantId: TENANT_ID,
        actorKeycloakId: 'admin-kc',
        entidadId: TENANT_ID,
        detalle: { campos: ['posSincronizacionHabilitada'] },
        antes: { posSincronizacionHabilitada: false },
        despues: { posSincronizacionHabilitada: true },
      });
    });

    it('sin cambios: no escribe ni audita', async () => {
      tx.restaurante.findUnique.mockResolvedValue({
        posSincronizacionHabilitada: true,
      });

      await service.cambiarHabilitada(TENANT_ID, 'admin-kc', true);
      expect(tx.restaurante.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    });

    it('sin restaurante: 404', async () => {
      tx.restaurante.findUnique.mockResolvedValue(null);
      await expect(
        service.cambiarHabilitada(TENANT_ID, 'admin-kc', false),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

describe('SincronizacionPosController (BL-488)', () => {
  it('pasa el tenant del token, los filtros, el id y el actor al servicio', async () => {
    const servicio = {
      listar: jest.fn().mockResolvedValue('lista'),
      reintentar: jest.fn().mockResolvedValue('reintento'),
      cambiarHabilitada: jest.fn().mockResolvedValue('cambio'),
    };
    const importacion = {
      resumen: jest.fn().mockResolvedValue('resumen'),
      importarAhora: jest.fn().mockResolvedValue('importadas'),
      simularVenta: jest.fn().mockResolvedValue('simulada'),
    };
    const controller = new SincronizacionPosController(
      servicio as any,
      importacion as any,
    );
    const req = { user: { tenantId: TENANT_ID, sub: 'admin-kc' } } as any;

    // BL-489: ventas hechas en el POS.
    await expect(controller.ventasDelPos(req)).resolves.toBe('resumen');
    await expect(controller.importar(req)).resolves.toBe('importadas');
    await expect(
      controller.simular(req, { total: 350, medioPago: 'EFECTIVO' }),
    ).resolves.toBe('simulada');
    expect(importacion.resumen).toHaveBeenCalledWith(TENANT_ID);
    expect(importacion.importarAhora).toHaveBeenCalledWith(TENANT_ID);
    expect(importacion.simularVenta).toHaveBeenCalledWith(TENANT_ID, {
      total: 350,
      medioPago: 'EFECTIVO',
    });

    await expect(controller.listar(req, { pagina: 2 })).resolves.toBe('lista');
    await expect(controller.reintentar(req, FILA_ID)).resolves.toBe(
      'reintento',
    );
    await expect(
      controller.cambiarConfiguracion(req, { habilitada: true }),
    ).resolves.toBe('cambio');
    expect(servicio.listar).toHaveBeenCalledWith(TENANT_ID, { pagina: 2 });
    expect(servicio.reintentar).toHaveBeenCalledWith(TENANT_ID, FILA_ID);
    expect(servicio.cambiarHabilitada).toHaveBeenCalledWith(
      TENANT_ID,
      'admin-kc',
      true,
    );
  });
});

describe('SincronizacionPosJob (BL-488)', () => {
  let servicio: { sincronizarTenant: jest.Mock; importarTenant: jest.Mock };
  let job: SincronizacionPosJob;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    servicio = {
      sincronizarTenant: jest
        .fn()
        .mockResolvedValueOnce({ revisados: 2, enviados: 1, fallidos: 1 })
        .mockRejectedValueOnce(new Error('falló'))
        .mockResolvedValue({ revisados: 1, enviados: 1, fallidos: 0 }),
      // BL-489: el mismo objeto hace de ImportacionVentasPosService.
      importarTenant: jest.fn().mockResolvedValue({
        recibidas: 2,
        nuevas: 1,
        actualizadas: 0,
        omitidas: 1,
      }),
    };
    job = new SincronizacionPosJob(
      { resolve: jest.fn().mockResolvedValue(servicio) } as any,
      {
        tenant: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 't1' }, { id: 't2' }, { id: 't3' }]),
        },
      } as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.POS_SINCRONIZACION_HABILITADA;
    delete process.env.POS_ADAPTER;
  });

  it('recorre los establecimientos de a uno; un error no frena a los demás', async () => {
    await expect(job.ejecutar()).resolves.toEqual({
      revisados: 3,
      enviados: 2,
      fallidos: 1,
      // t2 falló antes de importar: solo t1 y t3.
      importadas: { recibidas: 4, nuevas: 2, actualizadas: 0, omitidas: 2 },
    });
    expect(servicio.sincronizarTenant).toHaveBeenCalledTimes(3);
    expect(servicio.importarTenant).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'Sincronización con el POS: falló en el tenant t2: falló',
    );
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.objectContaining({
        revisados: 3,
        enviados: 2,
        ventasDelPos: 2,
        errores: 1,
      }),
    );
  });

  it('nunca dos corridas a la vez', async () => {
    const primera = job.ejecutar();
    await expect(job.ejecutar()).resolves.toBeNull();
    await primera;
  });

  it('sin nada que mandar ni traer, no escribe el resumen', async () => {
    servicio.sincronizarTenant = jest
      .fn()
      .mockResolvedValue({ revisados: 0, enviados: 0, fallidos: 0 });
    servicio.importarTenant = jest.fn().mockResolvedValue({
      recibidas: 1,
      nuevas: 0,
      actualizadas: 0,
      omitidas: 1,
    });
    await job.ejecutar();
    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it('BL-489: si solo trae ventas del POS, igual escribe el resumen', async () => {
    servicio.sincronizarTenant = jest
      .fn()
      .mockResolvedValue({ revisados: 0, enviados: 0, fallidos: 0 });
    servicio.importarTenant = jest.fn().mockResolvedValue({
      recibidas: 1,
      nuevas: 0,
      actualizadas: 1,
      omitidas: 0,
    });
    await job.ejecutar();
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.objectContaining({ ventasDelPos: 3, errores: 0 }),
    );
  });

  it('si no puede leer los establecimientos, no lanza', async () => {
    const roto = new SincronizacionPosJob(
      { resolve: jest.fn().mockResolvedValue(servicio) } as any,
      {
        tenant: {
          findMany: jest.fn().mockRejectedValue(new Error('sin base')),
        },
      } as any,
    );
    await expect(roto.ejecutar()).resolves.toEqual({
      revisados: 0,
      enviados: 0,
      fallidos: 0,
      importadas: { recibidas: 0, nuevas: 0, actualizadas: 0, omitidas: 0 },
    });
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'Sincronización con el POS: no se pudo ejecutar: sin base',
    );
  });

  it('apagado en los tests, o con POS_ADAPTER=deshabilitado: no programa nada', () => {
    const setInterval = jest.spyOn(global, 'setInterval');
    job.onApplicationBootstrap();

    process.env.POS_SINCRONIZACION_HABILITADA = 'true';
    process.env.POS_ADAPTER = 'deshabilitado';
    new SincronizacionPosJob(
      { resolve: jest.fn() } as any,
      { tenant: { findMany: jest.fn() } } as any,
    ).onApplicationBootstrap();

    expect(setInterval).not.toHaveBeenCalled();
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      'Sincronización con el POS: deshabilitada',
    );
    job.onModuleDestroy();
  });

  it('habilitado: programa la corrida con un timer que no frena el apagado', () => {
    process.env.POS_SINCRONIZACION_HABILITADA = 'true';
    const unref = jest.fn();
    const setInterval = jest
      .spyOn(global, 'setInterval')
      .mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    const habilitado = new SincronizacionPosJob(
      { resolve: jest.fn() } as any,
      { tenant: { findMany: jest.fn() } } as any,
    );
    const ejecutar = jest.spyOn(habilitado, 'ejecutar').mockResolvedValue(null);

    habilitado.onApplicationBootstrap();

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(unref).toHaveBeenCalled();
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      'Sincronización con el POS (mock): cada 60 s, hasta 10 intentos',
    );
    (setInterval.mock.calls[0][0] as () => void)();
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});

describe('DTOs de /admin/pos (BL-488)', () => {
  const errores = async <T extends object>(
    clase: new () => T,
    datos: Record<string, unknown>,
  ) =>
    (await validate(plainToInstance(clase, datos))).flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );

  it('listado: página numérica de 1 a 1000 y estado de la lista', async () => {
    const dto = plainToInstance(ConsultarSincronizacionesPosDto, {
      pagina: '3',
      estado: 'ERROR',
    });
    expect(dto.pagina).toBe(3);
    expect(await validate(dto)).toEqual([]);
    expect(
      await errores(ConsultarSincronizacionesPosDto, { pagina: '0' }),
    ).toEqual(['pagina debe ser 1 o más']);
    expect(
      await errores(ConsultarSincronizacionesPosDto, { estado: 'OTRO' }),
    ).toEqual([
      'estado debe ser uno de: PENDIENTE, ENVIADA, ERROR, DESCARTADA',
    ]);
  });

  it('configuración: habilitada es obligatoria y booleana', async () => {
    expect(
      await errores(CambiarSincronizacionPosDto, { habilitada: true }),
    ).toEqual([]);
    expect(
      await errores(CambiarSincronizacionPosDto, { habilitada: 'si' }),
    ).toEqual(['habilitada debe ser verdadero o falso']);
  });
});
