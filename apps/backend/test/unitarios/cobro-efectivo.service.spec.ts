import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RolesGuard } from '../../src/auth/roles.guard';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import {
  CobroEfectivoService,
  HORAS_PENDIENTES_RETIRO,
} from '../../src/pagos/efectivo/cobro-efectivo.service';
import { CobrosController } from '../../src/pagos/efectivo/cobros.controller';
import { RegistrarCobroEfectivoDto } from '../../src/pagos/efectivo/registrar-cobro-efectivo.dto';

// HU-031 (BL-201): registro de cobro en efectivo.

const TENANT = '11111111-1111-1111-1111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
// sub del token de Keycloak: siempre un UUID.
const ACTOR = '44444444-4444-4444-8444-444444444444';
const AHORA = new Date('2026-10-28T15:00:00.000Z');
const PEDIDO_KDS = { id: PEDIDO, estado: 'RECIBIDO' };

const dto = (overrides: Partial<RegistrarCobroEfectivoDto> = {}) => ({
  pedidoId: PEDIDO,
  idempotencyKey: 'efectivo-1',
  montoRecibido: '1000',
  ...overrides,
});

function pagoGuardado(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pago-1',
    pedidoId: PEDIDO,
    monto: new Prisma.Decimal('590.00'),
    medioPago: 'EFECTIVO',
    estado: 'APROBADO',
    ...overrides,
  };
}

describe('CobroEfectivoService (HU-031, BL-201)', () => {
  let tx: {
    pago: { findUnique: jest.Mock; create: jest.Mock };
    pedido: { findUnique: jest.Mock; findMany: jest.Mock };
    restaurante: { findUnique: jest.Mock };
    usuario: { findUnique: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let pedidos: {
    confirmarPagoEnTx: jest.Mock;
    notificarPedidoConfirmado: jest.Mock;
  };
  let cfe: { emitirEnSegundoPlano: jest.Mock };
  let auditLog: { registrarEnTx: jest.Mock };
  let service: CobroEfectivoService;

  beforeEach(() => {
    tx = {
      pago: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(pagoGuardado()),
      },
      pedido: {
        findUnique: jest.fn().mockResolvedValue({
          id: PEDIDO,
          estado: 'PENDIENTE_PAGO',
          lineas: [
            { subtotal: new Prisma.Decimal('390.00') },
            { subtotal: new Prisma.Decimal('200.00') },
          ],
          pagos: [],
        }),
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
      notificarPedidoConfirmado: jest.fn(),
    };
    cfe = { emitirEnSegundoPlano: jest.fn() };
    auditLog = { registrarEnTx: jest.fn() };
    service = new CobroEfectivoService(
      tenantPrisma as any,
      pedidos as any,
      cfe as any,
      auditLog as any,
    );
  });

  describe('registrar', () => {
    const registrar = (body = dto()) =>
      service.registrar(TENANT, ACTOR, body as RegistrarCobroEfectivoDto);

    it('crea el pago EFECTIVO/APROBADO con el total calculado en el backend', async () => {
      await registrar();

      expect(tx.pago.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT,
          pedidoId: PEDIDO,
          idempotencyKey: 'efectivo-1',
          monto: new Prisma.Decimal('590.00'),
          medioPago: 'EFECTIVO',
          estado: 'APROBADO',
        },
      });
    });

    it('pasa el pedido a RECIBIDO en la misma transacción, con quién cobró', async () => {
      await registrar();

      expect(pedidos.confirmarPagoEnTx).toHaveBeenCalledWith(
        tx,
        TENANT,
        PEDIDO,
        'u-mozo',
      );
      expect(tenantPrisma.runInTenantContext).toHaveBeenCalledTimes(1);
    });

    it('actor sin fila en usuario (usuario de plataforma): el historial queda sin usuario', async () => {
      tx.usuario.findUnique.mockResolvedValue(null);

      await registrar();

      expect(pedidos.confirmarPagoEnTx).toHaveBeenCalledWith(
        tx,
        TENANT,
        PEDIDO,
        null,
      );
    });

    it('actor que no es un UUID (un script): no busca el usuario y el historial queda sin usuario', async () => {
      await service.registrar(
        TENANT,
        'script:test',
        dto() as RegistrarCobroEfectivoDto,
      );

      expect(tx.usuario.findUnique).not.toHaveBeenCalled();
      expect(pedidos.confirmarPagoEnTx).toHaveBeenCalledWith(
        tx,
        TENANT,
        PEDIDO,
        null,
      );
    });

    it('calcula el vuelto y lo devuelve', async () => {
      await expect(registrar()).resolves.toEqual({
        pagoId: 'pago-1',
        pedidoId: PEDIDO,
        monto: '590.00',
        montoRecibido: '1000.00',
        vuelto: '410.00',
      });
    });

    it('monto justo: vuelto 0', async () => {
      const cobro = await registrar(dto({ montoRecibido: '590' }));

      expect(cobro.vuelto).toBe('0.00');
    });

    it('lo deja en la auditoría, dentro de la transacción, con recibido y vuelto', async () => {
      await registrar();

      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.PAGO_EFECTIVO_REGISTRADO,
        tenantId: TENANT,
        actorKeycloakId: ACTOR,
        entidadId: 'pago-1',
        despues: {
          monto: '590.00',
          montoRecibido: '1000.00',
          vuelto: '410.00',
        },
        detalle: { pedidoId: PEDIDO },
      });
    });

    it('confirmada la transacción: avisa al KDS y pide el CFE en segundo plano', async () => {
      await registrar();

      expect(pedidos.notificarPedidoConfirmado).toHaveBeenCalledWith(
        TENANT,
        PEDIDO_KDS,
      );
      expect(cfe.emitirEnSegundoPlano).toHaveBeenCalledWith(TENANT, 'pago-1');
    });

    it('efectivo deshabilitado en el establecimiento: 409 y no cobra', async () => {
      tx.restaurante.findUnique.mockResolvedValue({
        efectivoHabilitado: false,
      });

      await expect(registrar()).rejects.toThrow(
        new ConflictException(
          'El cobro en efectivo no está habilitado en este establecimiento',
        ),
      );
      expect(tx.pago.create).not.toHaveBeenCalled();
    });

    it('pedido inexistente (u de otro tenant, RLS): 404', async () => {
      tx.pedido.findUnique.mockResolvedValue(null);

      await expect(registrar()).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['RECIBIDO', 'Este pedido ya fue pagado'],
      ['ENTREGADO', 'Este pedido ya fue pagado'],
      ['CANCELADO', 'El pedido está cancelado'],
    ])('pedido en %s: 409 «%s»', async (estado, mensaje) => {
      tx.pedido.findUnique.mockResolvedValue({
        id: PEDIDO,
        estado,
        lineas: [],
        pagos: [],
      });

      await expect(registrar()).rejects.toThrow(new ConflictException(mensaje));
      expect(tx.pago.create).not.toHaveBeenCalled();
    });

    it('el comensal tiene un pago con tarjeta en curso: 409', async () => {
      tx.pedido.findUnique.mockResolvedValue({
        id: PEDIDO,
        estado: 'PENDIENTE_PAGO',
        lineas: [{ subtotal: new Prisma.Decimal('590.00') }],
        pagos: [{ id: 'pago-mp' }],
      });

      await expect(registrar()).rejects.toThrow(ConflictException);
      expect(tx.pago.create).not.toHaveBeenCalled();
    });

    it('monto recibido menor que el total: 400 con los dos montos', async () => {
      await expect(registrar(dto({ montoRecibido: '500' }))).rejects.toThrow(
        new BadRequestException(
          'El monto recibido ($ 500.00) es menor que el total del pedido ($ 590.00)',
        ),
      );
      expect(tx.pago.create).not.toHaveBeenCalled();
    });

    it('pedido sin monto: 400', async () => {
      tx.pedido.findUnique.mockResolvedValue({
        id: PEDIDO,
        estado: 'PENDIENTE_PAGO',
        lineas: [],
        pagos: [],
      });

      await expect(registrar()).rejects.toThrow(
        new BadRequestException('El pedido no tiene monto a cobrar'),
      );
    });

    it('otro cobro confirmó el pedido entre medio: 409 (se revierte el pago creado)', async () => {
      pedidos.confirmarPagoEnTx.mockResolvedValue(null);

      await expect(registrar()).rejects.toThrow(
        new ConflictException('Este pedido ya fue pagado'),
      );
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
      expect(pedidos.notificarPedidoConfirmado).not.toHaveBeenCalled();
      expect(cfe.emitirEnSegundoPlano).not.toHaveBeenCalled();
    });

    describe('idempotencia (RNF.03)', () => {
      it('misma clave: devuelve el mismo cobro sin crear otro ni avisar de nuevo', async () => {
        tx.pago.findUnique.mockResolvedValue(pagoGuardado());

        await expect(registrar()).resolves.toEqual({
          pagoId: 'pago-1',
          pedidoId: PEDIDO,
          monto: '590.00',
          montoRecibido: '1000.00',
          vuelto: '410.00',
        });
        expect(tx.pago.create).not.toHaveBeenCalled();
        expect(pedidos.notificarPedidoConfirmado).not.toHaveBeenCalled();
        expect(cfe.emitirEnSegundoPlano).not.toHaveBeenCalled();
      });

      it('la clave ya se usó en un pago con tarjeta: 409', async () => {
        tx.pago.findUnique.mockResolvedValue(
          pagoGuardado({ medioPago: 'MERCADOPAGO' }),
        );

        await expect(registrar()).rejects.toThrow(
          new ConflictException(
            'La clave de idempotencia ya se usó en otro cobro',
          ),
        );
      });

      it('la clave ya se usó en el cobro de otro pedido: 409', async () => {
        tx.pago.findUnique.mockResolvedValue(
          pagoGuardado({ pedidoId: 'otro-pedido' }),
        );

        await expect(registrar()).rejects.toThrow(ConflictException);
      });

      it('doble clic simultáneo: la clave única choca (P2002) y devuelve el cobro del primero', async () => {
        const duplicada = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          { code: 'P2002', clientVersion: 'test' },
        );
        tenantPrisma.runInTenantContext
          .mockRejectedValueOnce(duplicada)
          .mockImplementationOnce((_tenantId, callback) =>
            callback({ pago: { findUnique: () => pagoGuardado() } }),
          );

        await expect(registrar()).resolves.toMatchObject({
          pagoId: 'pago-1',
          vuelto: '410.00',
        });
      });

      it('P2002 pero el pago no aparece: propaga el error', async () => {
        const duplicada = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          { code: 'P2002', clientVersion: 'test' },
        );
        tenantPrisma.runInTenantContext
          .mockRejectedValueOnce(duplicada)
          .mockImplementationOnce((_tenantId, callback) =>
            callback({ pago: { findUnique: () => null } }),
          );

        await expect(registrar()).rejects.toBe(duplicada);
      });

      it('otro error de la base: se propaga', async () => {
        const error = new Error('conexión perdida');
        tenantPrisma.runInTenantContext.mockRejectedValueOnce(error);

        await expect(registrar()).rejects.toBe(error);
      });
    });
  });

  describe('pendientes', () => {
    it('busca los PENDIENTE_PAGO de las mesas y los para retirar de las últimas horas', async () => {
      await service.pendientes(TENANT, AHORA);

      const desde = new Date(
        AHORA.getTime() - HORAS_PENDIENTES_RETIRO * 60 * 60 * 1000,
      );
      expect(tx.pedido.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            estado: 'PENDIENTE_PAGO',
            OR: [
              { mesa: { esVirtual: false } },
              { mesa: { esVirtual: true }, createdAt: { gte: desde } },
            ],
          },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('devuelve el total, las líneas, si hay un pago en curso y si el efectivo está habilitado', async () => {
      tx.pedido.findMany.mockResolvedValue([
        {
          id: PEDIDO,
          canal: 'QR',
          createdAt: AHORA,
          mesa: { id: 'mesa-3', numero: 3, esVirtual: false },
          lineas: [
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
          ],
          pagos: [{ id: 'pago-mp' }],
        },
      ]);

      await expect(service.pendientes(TENANT, AHORA)).resolves.toEqual({
        efectivoHabilitado: true,
        pedidos: [
          {
            id: PEDIDO,
            canal: 'QR',
            createdAt: AHORA,
            mesa: { id: 'mesa-3', numero: 3, esVirtual: false },
            total: '590.00',
            lineas: [
              {
                id: 'l-1',
                nombre: 'Milanesa',
                cantidad: 1,
                subtotal: '390.00',
              },
              { id: 'l-2', nombre: 'Agua', cantidad: 2, subtotal: '200.00' },
            ],
            pagoEnCurso: true,
          },
        ],
      });
    });

    it('sin restaurante (no debería pasar): el efectivo figura deshabilitado', async () => {
      tx.restaurante.findUnique.mockResolvedValue(null);

      const respuesta = await service.pendientes(TENANT);

      expect(respuesta.efectivoHabilitado).toBe(false);
    });
  });
});

describe('CobrosController (HU-031, BL-201)', () => {
  it('pasa el tenant y el actor del token, nunca del body', async () => {
    const cobro = { registrar: jest.fn(), pendientes: jest.fn() };
    const controller = new CobrosController(cobro as any);
    const req = { user: { tenantId: TENANT, sub: ACTOR, roles: ['MOZO'] } };

    await controller.registrarEfectivo(req as any, dto());
    await controller.pendientes(req as any);

    expect(cobro.registrar).toHaveBeenCalledWith(TENANT, ACTOR, dto());
    expect(cobro.pendientes).toHaveBeenCalledWith(TENANT);
  });

  const guard = new RolesGuard(new Reflector());
  const contexto = (handler: unknown, roles: string[]) =>
    ({
      getHandler: () => handler,
      getClass: () => CobrosController,
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    }) as unknown as ExecutionContext;

  it.each([['ADMIN'], ['MOZO']])('%s puede cobrar y ver pendientes', (rol) => {
    for (const handler of [
      CobrosController.prototype.registrarEfectivo,
      CobrosController.prototype.pendientes,
    ]) {
      expect(guard.canActivate(contexto(handler, [rol]))).toBe(true);
    }
  });

  it.each([['COCINA'], ['COMENSAL'], ['PLATAFORMA']])(
    '%s recibe 403',
    (rol) => {
      expect(() =>
        guard.canActivate(
          contexto(CobrosController.prototype.registrarEfectivo, [rol]),
        ),
      ).toThrow(ForbiddenException);
      expect(() =>
        guard.canActivate(
          contexto(CobrosController.prototype.pendientes, [rol]),
        ),
      ).toThrow(ForbiddenException);
    },
  );
});

describe('RegistrarCobroEfectivoDto (HU-031, BL-201)', () => {
  const errores = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(RegistrarCobroEfectivoDto, body))).map(
      (e) => e.property,
    );

  it.each([['1000'], ['1000.5'], ['1000.50'], ['0']])(
    'acepta %s como monto recibido',
    async (montoRecibido) => {
      expect(await errores(dto({ montoRecibido }))).toEqual([]);
    },
  );

  it.each([['-100'], ['10.123'], ['abc'], [''], ['1e3'], ['123456789']])(
    'rechaza %s como monto recibido (negativo, más de 2 decimales o no numérico)',
    async (montoRecibido) => {
      expect(await errores(dto({ montoRecibido }))).toEqual(['montoRecibido']);
    },
  );

  it('exige pedidoId UUID e idempotencyKey de hasta 64 caracteres', async () => {
    expect(
      await errores(
        dto({ pedidoId: 'no-uuid', idempotencyKey: 'x'.repeat(65) }),
      ),
    ).toEqual(['pedidoId', 'idempotencyKey']);
  });
});
