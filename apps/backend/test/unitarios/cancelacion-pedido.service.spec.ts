import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RolesGuard } from '../../src/auth/roles.guard';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import { CancelacionPedidoService } from '../../src/pagos/cancelacion/cancelacion-pedido.service';
import { CancelacionPedidoController } from '../../src/pagos/cancelacion/cancelacion-pedido.controller';
import { CancelarPedidoDto } from '../../src/pagos/cancelacion/cancelar-pedido.dto';
import * as colaKds from '../../src/pedidos/cola-kds';

// HU-024 (BL-104): cancelación de un pedido pagado y devolución del pago.

const TENANT = '11111111-1111-1111-1111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const ACTOR = '44444444-4444-4444-8444-444444444444';

const pago = (extra: Record<string, unknown> = {}) => ({
  id: 'pago-mp',
  estado: 'APROBADO',
  medioPago: 'MERCADOPAGO',
  monto: new Prisma.Decimal('590.00'),
  pasarelaReferencia: 'ORD1',
  ...extra,
});

describe('CancelacionPedidoService (HU-024, BL-104)', () => {
  let tx: {
    pedido: { findUnique: jest.Mock; updateMany: jest.Mock };
    pago: { updateMany: jest.Mock };
    pagoEstadoHistorial: { create: jest.Mock };
    pedidoEstadoHistorial: { create: jest.Mock };
    usuario: { findUnique: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let pedidos: {
    reponerStockEnTx: jest.Mock;
    notificarPedidoCancelado: jest.Mock;
  };
  let cfe: { emitirNotaDeCreditoEnSegundoPlano: jest.Mock };
  let auditLog: { registrarEnTx: jest.Mock };
  let mercadoPago: { reembolsarOrden: jest.Mock };
  let service: CancelacionPedidoService;

  const conPagos = (estado: string, pagos: unknown[]) =>
    tx.pedido.findUnique.mockImplementation(({ select }) =>
      Promise.resolve(
        select.pagos ? { id: PEDIDO, estado, pagos } : { estado },
      ),
    );

  const cancelar = (dto: Partial<CancelarPedidoDto> = {}) =>
    service.cancelar(TENANT, ACTOR, PEDIDO, {
      motivo: 'RECLAMO_CLIENTE',
      ...dto,
    } as CancelarPedidoDto);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest
      .spyOn(colaKds, 'completarCapacidad')
      .mockResolvedValue([{ id: 'otro' } as never]);
    tx = {
      pedido: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pago: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      pagoEstadoHistorial: { create: jest.fn() },
      pedidoEstadoHistorial: { create: jest.fn() },
      usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-mozo' }) },
    };
    conPagos('RECIBIDO', [pago()]);
    tenantPrisma = {
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    pedidos = {
      reponerStockEnTx: jest.fn().mockResolvedValue(['item-1']),
      notificarPedidoCancelado: jest.fn(),
    };
    cfe = { emitirNotaDeCreditoEnSegundoPlano: jest.fn() };
    auditLog = { registrarEnTx: jest.fn() };
    mercadoPago = { reembolsarOrden: jest.fn().mockResolvedValue(undefined) };
    service = new CancelacionPedidoService(
      tenantPrisma as any,
      pedidos as any,
      cfe as any,
      auditLog as any,
      mercadoPago as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('vistaPrevia', () => {
    it('dice cuánto se devuelve, por qué medio y si vuelve el stock', async () => {
      conPagos('RECIBIDO', [
        pago(),
        pago({
          id: 'pago-ef',
          medioPago: 'EFECTIVO',
          pasarelaReferencia: null,
        }),
        pago({ id: 'rechazado', estado: 'RECHAZADO' }),
      ]);

      await expect(service.vistaPrevia(TENANT, PEDIDO)).resolves.toEqual({
        pedidoId: PEDIDO,
        estado: 'RECIBIDO',
        monto: '1180.00',
        motivoNoCancelable: null,
        devoluciones: [
          {
            pagoId: 'pago-mp',
            medio: 'MERCADOPAGO',
            monto: '590.00',
            automatica: true,
          },
          {
            pagoId: 'pago-ef',
            medio: 'EFECTIVO',
            monto: '590.00',
            automatica: false,
          },
        ],
        repondraStock: true,
      });
    });

    it.each([
      [
        'LISTO_PARA_ENTREGAR',
        'Solo se puede cancelar un pedido recibido o en preparación',
      ],
      [
        'ENTREGADO',
        'Solo se puede cancelar un pedido recibido o en preparación',
      ],
      ['CANCELADO', 'El pedido ya está cancelado'],
    ])('%s: dice por qué no se puede', async (estado, motivo) => {
      conPagos(estado, [pago()]);

      await expect(service.vistaPrevia(TENANT, PEDIDO)).resolves.toMatchObject({
        motivoNoCancelable: motivo,
        repondraStock: false,
      });
    });

    it('pedido inexistente (u otro tenant, RLS): 404', async () => {
      tx.pedido.findUnique.mockResolvedValue(null);

      await expect(service.vistaPrevia(TENANT, PEDIDO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cancelar con Mercado Pago', () => {
    it('primero reembolsa en Mercado Pago (clave fija por pago) y deja el pago REEMBOLSADO', async () => {
      await cancelar();

      expect(mercadoPago.reembolsarOrden).toHaveBeenCalledWith(
        'ORD1',
        TENANT,
        'reembolso-pago-mp',
      );
      expect(tx.pago.updateMany).toHaveBeenCalledWith({
        where: { id: 'pago-mp', estado: 'APROBADO' },
        data: {
          estado: 'REEMBOLSADO',
          cfeIntentos: 0,
          cfeUltimoIntentoEn: null,
          cfeUltimoError: null,
        },
      });
      expect(tx.pagoEstadoHistorial.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          pagoId: 'pago-mp',
          estadoNuevo: 'REEMBOLSADO',
          origen: 'CANCELACION',
          detalle: 'REEMBOLSO_MERCADOPAGO',
        }),
      });
    });

    it('cancela el pedido con quién lo hizo, repone el stock (estaba RECIBIDO) y completa la cola', async () => {
      const resultado = await cancelar();

      expect(tx.pedido.updateMany).toHaveBeenCalledWith({
        where: {
          id: PEDIDO,
          estado: { in: ['RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_ENTREGAR'] },
        },
        data: { estado: 'CANCELADO' },
      });
      expect(tx.pedidoEstadoHistorial.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT,
          pedidoId: PEDIDO,
          usuarioId: 'u-mozo',
          estadoAnterior: 'RECIBIDO',
          estadoNuevo: 'CANCELADO',
        },
      });
      expect(pedidos.reponerStockEnTx).toHaveBeenCalledWith(tx, TENANT, PEDIDO);
      expect(colaKds.completarCapacidad).toHaveBeenCalledWith(tx, TENANT);
      expect(resultado).toEqual({
        pedidoId: PEDIDO,
        estado: 'CANCELADO',
        monto: '590.00',
        devoluciones: [
          {
            pagoId: 'pago-mp',
            medio: 'MERCADOPAGO',
            monto: '590.00',
            automatica: true,
          },
        ],
        stockRepuesto: true,
      });
    });

    it('auditoría en la transacción: motivo, monto, devolución y stock', async () => {
      await cancelar({ motivo: 'OTRO', detalle: 'Se fue sin esperar' });

      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.PEDIDO_CANCELADO,
        tenantId: TENANT,
        actorKeycloakId: ACTOR,
        entidadId: PEDIDO,
        despues: {
          motivo: 'Otro',
          monto: '590.00',
          devolucion: 'Mercado Pago (reembolso automático)',
          stockRepuesto: true,
        },
        detalle: {
          motivo: 'OTRO',
          detalle: 'Se fue sin esperar',
          estadoAnterior: 'RECIBIDO',
          pagos: ['pago-mp'],
        },
      });
    });

    it('después del commit: avisa al KDS, la cola y la carta, y pide la nota de crédito', async () => {
      await cancelar();

      expect(pedidos.notificarPedidoCancelado).toHaveBeenCalledWith(
        TENANT,
        PEDIDO,
        [{ id: 'otro' }],
        ['item-1'],
      );
      expect(cfe.emitirNotaDeCreditoEnSegundoPlano).toHaveBeenCalledWith(
        TENANT,
        'pago-mp',
      );
    });

    it('si Mercado Pago falla: 502 y el pedido NO se cancela', async () => {
      mercadoPago.reembolsarOrden.mockRejectedValue(
        new BadGatewayException('x'),
      );

      await expect(cancelar()).rejects.toThrow(
        'Mercado Pago no pudo hacer el reembolso. El pedido no se canceló',
      );
      expect(tx.pago.updateMany).not.toHaveBeenCalled();
      expect(tx.pedido.updateMany).not.toHaveBeenCalled();
      expect(cfe.emitirNotaDeCreditoEnSegundoPlano).not.toHaveBeenCalled();
    });

    it('reintento después de un fallo a mitad: el pago ya devuelto no se reembolsa de nuevo, pero entra en la cancelación', async () => {
      conPagos('EN_PREPARACION', [pago({ estado: 'REEMBOLSADO' })]);

      const resultado = await cancelar();

      expect(mercadoPago.reembolsarOrden).not.toHaveBeenCalled();
      expect(resultado.devoluciones).toHaveLength(1);
      expect(cfe.emitirNotaDeCreditoEnSegundoPlano).toHaveBeenCalledWith(
        TENANT,
        'pago-mp',
      );
    });

    it('sin referencia de la order: 409 sin llamar a Mercado Pago', async () => {
      conPagos('RECIBIDO', [pago({ pasarelaReferencia: null })]);

      await expect(cancelar()).rejects.toBeInstanceOf(ConflictException);
      expect(mercadoPago.reembolsarOrden).not.toHaveBeenCalled();
    });
  });

  describe('cancelar con efectivo o POS (devolución manual)', () => {
    beforeEach(() => {
      conPagos('EN_PREPARACION', [
        pago({
          id: 'pago-pos',
          medioPago: 'POS_DEBITO',
          pasarelaReferencia: 'A1B2C3',
        }),
      ]);
    });

    it('sin la confirmación de la devolución: 400 y no cambia nada', async () => {
      await expect(cancelar()).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.pedido.updateMany).not.toHaveBeenCalled();
    });

    it('con la confirmación: pago REEMBOLSADO (devolución manual) en la misma transacción, sin Mercado Pago', async () => {
      const resultado = await cancelar({ devolucionManualConfirmada: true });

      expect(mercadoPago.reembolsarOrden).not.toHaveBeenCalled();
      expect(tx.pagoEstadoHistorial.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          pagoId: 'pago-pos',
          detalle: 'DEVOLUCION_MANUAL',
        }),
      });
      expect(tx.pedido.updateMany).toHaveBeenCalledWith({
        where: { id: PEDIDO, estado: { in: ['RECIBIDO', 'EN_PREPARACION'] } },
        data: { estado: 'CANCELADO' },
      });
      // Estaba EN_PREPARACION: el stock no vuelve.
      expect(pedidos.reponerStockEnTx).not.toHaveBeenCalled();
      expect(resultado.stockRepuesto).toBe(false);
      expect(auditLog.registrarEnTx.mock.calls[0][1].despues.devolucion).toBe(
        'Débito (POS del local) (devolución manual)',
      );
    });

    it('si cocina lo pasó a listo entre medio: 409 (se revierte la transacción)', async () => {
      tx.pedido.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        cancelar({ devolucionManualConfirmada: true }),
      ).rejects.toThrow('El pedido cambió de estado mientras se cancelaba');
      expect(pedidos.notificarPedidoCancelado).not.toHaveBeenCalled();
    });
  });

  it.each([
    [
      'LISTO_PARA_ENTREGAR',
      'Solo se puede cancelar un pedido recibido o en preparación',
    ],
    ['ENTREGADO', 'Solo se puede cancelar un pedido recibido o en preparación'],
    ['CANCELADO', 'El pedido ya está cancelado'],
  ])('pedido %s: 409 sin devolver nada', async (estado, mensaje) => {
    conPagos(estado, [pago()]);

    await expect(cancelar()).rejects.toThrow(new ConflictException(mensaje));
    expect(mercadoPago.reembolsarOrden).not.toHaveBeenCalled();
  });

  it('un medio que no se puede devolver (Plexo): 409', async () => {
    conPagos('RECIBIDO', [pago({ medioPago: 'PLEXO' })]);

    await expect(cancelar()).rejects.toThrow(
      'No se puede devolver un pago con PLEXO',
    );
  });
});

describe('CancelacionPedidoController (HU-024, BL-104)', () => {
  it('pasa el tenant y el actor del token, nunca del body', async () => {
    const servicio = { vistaPrevia: jest.fn(), cancelar: jest.fn() };
    const controller = new CancelacionPedidoController(servicio as any);
    const req = { user: { tenantId: TENANT, sub: ACTOR, roles: ['MOZO'] } };
    const dto = { motivo: 'ERROR_PEDIDO' } as CancelarPedidoDto;

    await controller.vistaPrevia(req as any, PEDIDO);
    await controller.cancelar(req as any, PEDIDO, dto);

    expect(servicio.vistaPrevia).toHaveBeenCalledWith(TENANT, PEDIDO);
    expect(servicio.cancelar).toHaveBeenCalledWith(TENANT, ACTOR, PEDIDO, dto);
  });

  const guard = new RolesGuard(new Reflector());
  const contexto = (handler: unknown, roles: string[]) =>
    ({
      getHandler: () => handler,
      getClass: () => CancelacionPedidoController,
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    }) as unknown as ExecutionContext;

  it.each([['ADMIN'], ['MOZO']])('%s puede cancelar', (rol) => {
    for (const handler of [
      CancelacionPedidoController.prototype.vistaPrevia,
      CancelacionPedidoController.prototype.cancelar,
    ]) {
      expect(guard.canActivate(contexto(handler, [rol]))).toBe(true);
    }
  });

  it.each([['COCINA'], ['COMENSAL'], ['PLATAFORMA']])(
    '%s recibe 403',
    (rol) => {
      expect(() =>
        guard.canActivate(
          contexto(CancelacionPedidoController.prototype.cancelar, [rol]),
        ),
      ).toThrow(ForbiddenException);
    },
  );
});

describe('CancelarPedidoDto (HU-024, BL-104)', () => {
  const errores = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(CancelarPedidoDto, body))).map(
      (e) => e.property,
    );

  it('acepta los motivos de la lista, con detalle opcional', async () => {
    expect(await errores({ motivo: 'ERROR_PEDIDO' })).toEqual([]);
    expect(
      await errores({ motivo: 'COBRO_DUPLICADO', detalle: 'Doble cobro' }),
    ).toEqual([]);
  });

  it('rechaza un motivo fuera de la lista', async () => {
    expect(await errores({ motivo: 'PORQUE_SI' })).toEqual(['motivo']);
  });

  it('con «Otro» el detalle es obligatorio y tiene hasta 200 caracteres', async () => {
    expect(await errores({ motivo: 'OTRO' })).toEqual(['detalle']);
    expect(await errores({ motivo: 'OTRO', detalle: '   ' })).toEqual([
      'detalle',
    ]);
    expect(await errores({ motivo: 'OTRO', detalle: 'x'.repeat(201) })).toEqual(
      ['detalle'],
    );
    expect(await errores({ motivo: 'OTRO', detalle: ' Se fue ' })).toEqual([]);
  });

  it('la confirmación de la devolución manual es verdadero o falso', async () => {
    expect(
      await errores({
        motivo: 'ERROR_PEDIDO',
        devolucionManualConfirmada: 'si',
      }),
    ).toEqual(['devolucionManualConfirmada']);
  });
});
