import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import { CobroEfectivoService } from '../../src/pagos/efectivo/cobro-efectivo.service';
import { RegistrarCobroEfectivoDto } from '../../src/pagos/efectivo/registrar-cobro-efectivo.dto';
import { RegistrarCobroPosDto } from '../../src/pagos/pos/registrar-cobro-pos.dto';

// HU-022 (BL-494, BL-85, BL-86): el personal cobra la propina que eligió el
// comensal, sin poder cambiarla.

const TENANT = '11111111-1111-1111-1111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const AHORA = new Date('2026-11-09T15:00:00.000Z');
const PEDIDO_KDS = { id: PEDIDO, estado: 'RECIBIDO' };

// consumo $ 590: 15 % = 88,5 → 89, total $ 679.
function pedidoConPropina(eleccion: Record<string, unknown> = {}) {
  return {
    id: PEDIDO,
    estado: 'PENDIENTE_PAGO',
    propinaPorcentaje: null,
    propinaMonto: null,
    lineas: [
      { subtotal: new Prisma.Decimal('390.00') },
      { subtotal: new Prisma.Decimal('200.00') },
    ],
    pagos: [],
    ...eleccion,
  };
}

function pagoGuardado(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pago-1',
    pedidoId: PEDIDO,
    monto: new Prisma.Decimal('590.00'),
    propina: new Prisma.Decimal('89.00'),
    medioPago: 'EFECTIVO',
    estado: 'APROBADO',
    ...overrides,
  };
}

describe('CobroEfectivoService con propina (HU-022, BL-494)', () => {
  let tx: {
    pago: { findUnique: jest.Mock; create: jest.Mock };
    pedido: { findUnique: jest.Mock; findMany: jest.Mock };
    restaurante: { findUnique: jest.Mock };
    usuario: { findUnique: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let pedidos: {
    confirmarPagoEnTx: jest.Mock;
    verificarStockEnTx: jest.Mock;
    notificarPedidoConfirmado: jest.Mock;
  };
  let auditLog: { registrarEnTx: jest.Mock };
  let service: CobroEfectivoService;

  beforeEach(() => {
    tx = {
      pago: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(pagoGuardado()),
      },
      pedido: {
        findUnique: jest
          .fn()
          .mockResolvedValue(pedidoConPropina({ propinaPorcentaje: 15 })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({ efectivoHabilitado: true }),
      },
      usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-mozo' }) },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    pedidos = {
      confirmarPagoEnTx: jest.fn().mockResolvedValue(PEDIDO_KDS),
      verificarStockEnTx: jest.fn().mockResolvedValue(undefined),
      notificarPedidoConfirmado: jest.fn(),
    };
    auditLog = { registrarEnTx: jest.fn() };
    service = new CobroEfectivoService(
      tenantPrisma as any,
      pedidos as any,
      { emitirEnSegundoPlano: jest.fn() } as any,
      auditLog as any,
    );
  });

  describe('efectivo', () => {
    const registrar = (extra: Record<string, unknown> = {}) =>
      service.registrar(TENANT, ACTOR, {
        pedidoId: PEDIDO,
        idempotencyKey: 'efectivo-1',
        montoRecibido: '1000',
        ...extra,
      } as RegistrarCobroEfectivoDto);

    it('el pago guarda el consumo en monto y la propina elegida aparte', async () => {
      await registrar();

      const { data } = tx.pago.create.mock.calls[0][0];
      expect(data.monto.toString()).toBe('590');
      expect(data.propina.toString()).toBe('89');
    });

    it('el vuelto se calcula sobre el total con propina', async () => {
      await expect(registrar()).resolves.toEqual({
        pagoId: 'pago-1',
        pedidoId: PEDIDO,
        monto: '679.00',
        consumo: '590.00',
        propina: '89.00',
        montoRecibido: '1000.00',
        vuelto: '321.00',
      });
    });

    it('monto recibido menor que el total con propina: 400 con los dos montos y no cobra', async () => {
      await expect(registrar({ montoRecibido: '650' })).rejects.toThrow(
        new BadRequestException(
          'El monto recibido ($ 650.00) es menor que el total del pedido ($ 679.00)',
        ),
      );
      expect(tx.pago.create).not.toHaveBeenCalled();
    });

    it('la auditoría deja el total, el consumo y la propina', async () => {
      await registrar();

      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.PAGO_EFECTIVO_REGISTRADO,
        tenantId: TENANT,
        actorKeycloakId: ACTOR,
        entidadId: 'pago-1',
        despues: {
          monto: '679.00',
          consumo: '590.00',
          propina: '89.00',
          montoRecibido: '1000.00',
          vuelto: '321.00',
        },
        detalle: { pedidoId: PEDIDO },
      });
    });

    it('con monto libre de $ 100: se cobra el consumo más 100', async () => {
      tx.pedido.findUnique.mockResolvedValue(
        pedidoConPropina({ propinaMonto: 100 }),
      );
      tx.pago.create.mockResolvedValue(
        pagoGuardado({ propina: new Prisma.Decimal('100.00') }),
      );

      const cobro = await registrar();

      expect(tx.pago.create.mock.calls[0][0].data.propina.toString()).toBe(
        '100',
      );
      expect(cobro.monto).toBe('690.00');
    });

    describe('totalEsperado: el total que el personal vio en pantalla', () => {
      it('coincide con el total con propina: se cobra', async () => {
        await expect(
          registrar({ totalEsperado: '679.00' }),
        ).resolves.toMatchObject({ pagoId: 'pago-1', monto: '679.00' });
        expect(tx.pago.create).toHaveBeenCalled();
      });

      it('679 y 679.00 son el mismo total', async () => {
        await expect(
          registrar({ totalEsperado: '679' }),
        ).resolves.toMatchObject({ pagoId: 'pago-1' });
      });

      it('el comensal cambió la propina mientras tanto: 409 con el total nuevo y no cobra', async () => {
        await expect(registrar({ totalEsperado: '590.00' })).rejects.toThrow(
          new ConflictException(
            'El total del pedido cambió: ahora es $ 679.00. Actualizá la lista antes de cobrar.',
          ),
        );
        expect(tx.pago.create).not.toHaveBeenCalled();
        expect(pedidos.confirmarPagoEnTx).not.toHaveBeenCalled();
        expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
      });

      it('sin totalEsperado (clientes anteriores): no se controla', async () => {
        await expect(registrar()).resolves.toMatchObject({ pagoId: 'pago-1' });
      });

      it('un reintento con la misma clave devuelve el cobro original aunque el total ya no coincida', async () => {
        tx.pago.findUnique.mockResolvedValue(pagoGuardado());

        await expect(
          registrar({ totalEsperado: '590.00' }),
        ).resolves.toMatchObject({ pagoId: 'pago-1', monto: '679.00' });
        expect(tx.pago.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('POS', () => {
    const registrarPos = (extra: Record<string, unknown> = {}) =>
      service.registrarPos(TENANT, ACTOR, {
        pedidoId: PEDIDO,
        idempotencyKey: 'pos-1',
        tarjeta: 'DEBITO',
        autorizacion: 'A1B2C3',
        ...extra,
      } as RegistrarCobroPosDto);

    beforeEach(() => {
      tx.restaurante.findUnique.mockResolvedValue({ posHabilitado: true });
      tx.pago.create.mockResolvedValue(
        pagoGuardado({
          medioPago: 'POS_DEBITO',
          pasarelaReferencia: 'A1B2C3',
        }),
      );
    });

    it('el pago guarda el consumo en monto y la propina aparte, y la respuesta informa el total', async () => {
      await expect(registrarPos()).resolves.toEqual({
        pagoId: 'pago-1',
        pedidoId: PEDIDO,
        monto: '679.00',
        consumo: '590.00',
        propina: '89.00',
        tarjeta: 'DEBITO',
        autorizacion: 'A1B2C3',
      });
      const { data } = tx.pago.create.mock.calls[0][0];
      expect(data.monto.toString()).toBe('590');
      expect(data.propina.toString()).toBe('89');
    });

    it('la auditoría deja el total, el consumo, la propina, el medio y la autorización', async () => {
      await registrarPos();

      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.PAGO_POS_REGISTRADO,
        tenantId: TENANT,
        actorKeycloakId: ACTOR,
        entidadId: 'pago-1',
        despues: {
          monto: '679.00',
          consumo: '590.00',
          propina: '89.00',
          medio: 'Débito',
          autorizacion: 'A1B2C3',
        },
        detalle: { pedidoId: PEDIDO },
      });
    });

    it('totalEsperado distinto del total con propina: 409 y no cobra', async () => {
      await expect(registrarPos({ totalEsperado: '590.00' })).rejects.toThrow(
        new ConflictException(
          'El total del pedido cambió: ahora es $ 679.00. Actualizá la lista antes de cobrar.',
        ),
      );
      expect(tx.pago.create).not.toHaveBeenCalled();
    });

    it('totalEsperado igual al total con propina: se cobra', async () => {
      await expect(
        registrarPos({ totalEsperado: '679.00' }),
      ).resolves.toMatchObject({ pagoId: 'pago-1', monto: '679.00' });
    });
  });

  describe('pendientes: el mozo ve la propina elegida, solo lectura', () => {
    const lineas = [
      {
        id: 'l-1',
        nombreSnapshot: 'Milanesa',
        cantidad: 1,
        subtotal: new Prisma.Decimal('390'),
      },
      {
        id: 'l-2',
        nombreSnapshot: 'Agua',
        cantidad: 2,
        subtotal: new Prisma.Decimal('200'),
      },
    ];
    const pendiente = (eleccion: Record<string, unknown>) => ({
      id: PEDIDO,
      canal: 'QR',
      createdAt: AHORA,
      mesa: { id: 'mesa-3', numero: 3, esVirtual: false },
      lineas,
      pagos: [],
      propinaPorcentaje: null,
      propinaMonto: null,
      ...eleccion,
    });

    it('con porcentaje: informa consumo, propina, porcentaje y el total a cobrar', async () => {
      tx.pedido.findMany.mockResolvedValue([
        pendiente({ propinaPorcentaje: 15 }),
      ]);

      const { pedidos: lista } = await service.pendientes(TENANT, AHORA);

      expect(lista[0]).toMatchObject({
        total: '679.00',
        consumo: '590.00',
        propina: '89.00',
        propinaPorcentaje: 15,
      });
    });

    it('con monto libre: no hay porcentaje y el total suma el monto', async () => {
      tx.pedido.findMany.mockResolvedValue([pendiente({ propinaMonto: 100 })]);

      const { pedidos: lista } = await service.pendientes(TENANT, AHORA);

      expect(lista[0]).toMatchObject({
        total: '690.00',
        consumo: '590.00',
        propina: '100.00',
        propinaPorcentaje: null,
      });
    });

    it('sin propina elegida: propina 0 y el total es el consumo', async () => {
      tx.pedido.findMany.mockResolvedValue([pendiente({})]);

      const { pedidos: lista } = await service.pendientes(TENANT, AHORA);

      expect(lista[0]).toMatchObject({
        total: '590.00',
        consumo: '590.00',
        propina: '0.00',
        propinaPorcentaje: null,
      });
    });
  });
});

describe('totalEsperado en los DTO (HU-022, BL-86)', () => {
  const baseEfectivo = {
    pedidoId: PEDIDO,
    idempotencyKey: 'efectivo-1',
    montoRecibido: '1000',
  };
  const basePos = {
    pedidoId: PEDIDO,
    idempotencyKey: 'pos-1',
    tarjeta: 'DEBITO',
    autorizacion: 'A1B2C3',
  };
  const erroresEfectivo = async (body: Record<string, unknown>) =>
    (
      await validate(
        plainToInstance(RegistrarCobroEfectivoDto, {
          ...baseEfectivo,
          ...body,
        }),
      )
    ).map((e) => e.property);
  const erroresPos = async (body: Record<string, unknown>) =>
    (
      await validate(
        plainToInstance(RegistrarCobroPosDto, { ...basePos, ...body }),
      )
    ).map((e) => e.property);

  it('es opcional en efectivo y en POS', async () => {
    expect(await erroresEfectivo({})).toEqual([]);
    expect(await erroresPos({})).toEqual([]);
  });

  it.each([['679'], ['679.5'], ['679.50']])(
    'acepta %s como total esperado',
    async (totalEsperado) => {
      expect(await erroresEfectivo({ totalEsperado })).toEqual([]);
      expect(await erroresPos({ totalEsperado })).toEqual([]);
    },
  );

  it.each([['-1'], ['10.123'], ['abc'], [''], ['1e3'], ['123456789']])(
    'rechaza %s como total esperado',
    async (totalEsperado) => {
      expect(await erroresEfectivo({ totalEsperado })).toEqual([
        'totalEsperado',
      ]);
      expect(await erroresPos({ totalEsperado })).toEqual(['totalEsperado']);
    },
  );
});
