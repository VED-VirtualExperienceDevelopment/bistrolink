import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CrearPagoDto } from '../../src/pagos/dto/crear-pago.dto';
import { PagoRechazadoException } from '../../src/pagos/gateways/pago-rechazado.exception';
import { PagoTemporalmenteNoDisponibleException } from '../../src/pagos/gateways/pago-temporalmente-no-disponible.exception';
import { PagosService } from '../../src/pagos/pagos.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const PAGO_ID = 'a4a91b9c-a546-4b7a-be01-cd8861294bae';

const DTO: CrearPagoDto = {
  pedidoId: PEDIDO_ID,
  idempotencyKey: 'pago-001',
  medioPago: 'MERCADOPAGO',
  datosPasarela: { token: 'tok', paymentMethodId: 'master' },
};

function crearTx() {
  return {
    pago: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => ({ id: PAGO_ID, ...data })),
      update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    pedido: {
      findUnique: jest.fn().mockResolvedValue({
        id: PEDIDO_ID,
        mesaId: MESA_ID,
        // 400 + 190 = 590: el monto sale de las líneas, no del cliente (BL-90).
        lineas: [
          { subtotal: new Prisma.Decimal('400') },
          { subtotal: new Prisma.Decimal('190') },
        ],
      }),
    },
    mesa: { update: jest.fn() },
  };
}

describe('PagosService.crear', () => {
  let tx: ReturnType<typeof crearTx>;
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let gateway: { cobrar: jest.Mock };
  let gatewayFactory: { obtener: jest.Mock };
  let service: PagosService;

  beforeEach(() => {
    tx = crearTx();
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    gateway = {
      cobrar: jest
        .fn()
        .mockResolvedValue({ aprobado: true, pasarelaReferencia: 'ORD1' }),
    };
    gatewayFactory = { obtener: jest.fn().mockReturnValue(gateway) };
    service = new PagosService(tenantPrisma as any, gatewayFactory as any);
  });

  const estadosDeMesa = () =>
    tx.mesa.update.mock.calls.map((c) => c[0].data.estado);

  describe('camino feliz', () => {
    it('reserva el pago PENDIENTE, cobra, lo marca APROBADO y libera la mesa', async () => {
      const pago = await service.crear(TENANT_ID, DTO);

      expect(tx.pago.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          pedidoId: PEDIDO_ID,
          idempotencyKey: 'pago-001',
          medioPago: 'MERCADOPAGO',
          estado: 'PENDIENTE',
        }),
      });
      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: PAGO_ID },
        data: { estado: 'APROBADO', pasarelaReferencia: 'ORD1' },
      });
      expect(estadosDeMesa()).toEqual(['EN_PROCESO_DE_PAGO', 'LIBRE']);
      expect(pago).toMatchObject({ id: PAGO_ID, estado: 'APROBADO' });
    });

    it('BL-90: el monto se calcula en el backend sumando las líneas del pedido', async () => {
      await service.crear(TENANT_ID, DTO);

      const montoReservado = tx.pago.create.mock.calls[0][0].data.monto;
      expect(montoReservado.toString()).toBe('590');
      expect(gateway.cobrar).toHaveBeenCalledWith(
        expect.objectContaining({ pedidoId: PEDIDO_ID, tenantId: TENANT_ID }),
      );
      expect(gateway.cobrar.mock.calls[0][0].monto.toString()).toBe('590');
    });

    it('elige la pasarela según el medio de pago y le pasa los datos de la tarjeta', async () => {
      await service.crear(TENANT_ID, DTO);

      expect(gatewayFactory.obtener).toHaveBeenCalledWith('MERCADOPAGO');
      expect(gateway.cobrar).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'pago-001',
          datosPasarela: DTO.datosPasarela,
        }),
      );
    });

    it('el cobro se hace FUERA de la transacción (la pasarela puede tardar)', async () => {
      let dentroDeTransaccion = false;
      tenantPrisma.runInTenantContext.mockImplementation(async (_t, cb) => {
        dentroDeTransaccion = true;
        try {
          return await cb(tx);
        } finally {
          dentroDeTransaccion = false;
        }
      });
      let cobroDentro: boolean | undefined;
      gateway.cobrar.mockImplementation(async () => {
        cobroDentro = dentroDeTransaccion;
        return { aprobado: true, pasarelaReferencia: 'ORD1' };
      });

      await service.crear(TENANT_ID, DTO);

      expect(cobroDentro).toBe(false);
    });
  });

  describe('idempotencia (BL-77)', () => {
    it('misma idempotencyKey => devuelve el pago existente y NO vuelve a cobrar', async () => {
      const existente = { id: PAGO_ID, estado: 'APROBADO' };
      tx.pago.findUnique.mockResolvedValue(existente);

      const pago = await service.crear(TENANT_ID, DTO);

      expect(pago).toBe(existente);
      expect(gateway.cobrar).not.toHaveBeenCalled();
      expect(tx.pedido.findUnique).not.toHaveBeenCalled();
      expect(tx.pago.create).not.toHaveBeenCalled();
    });

    it('BL-89 concurrencia: dos requests con la misma clave => el segundo choca con la clave única y recibe el pago del primero', async () => {
      const existente = { id: PAGO_ID, estado: 'PENDIENTE' };
      let llamadas = 0;
      tenantPrisma.runInTenantContext.mockImplementation(async (_t, cb) => {
        llamadas++;
        if (llamadas === 1) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        return cb(tx);
      });
      tx.pago.findUnique.mockResolvedValue(existente);

      const pago = await service.crear(TENANT_ID, DTO);

      expect(pago).toBe(existente);
      expect(gateway.cobrar).not.toHaveBeenCalled();
    });

    it('un error distinto de la clave duplicada no se traga', async () => {
      tenantPrisma.runInTenantContext.mockRejectedValue(
        new Error('base caída'),
      );

      await expect(service.crear(TENANT_ID, DTO)).rejects.toThrow('base caída');
      expect(gateway.cobrar).not.toHaveBeenCalled();
    });
  });

  describe('validaciones (no se cobra nada)', () => {
    it('pedido inexistente => 404', async () => {
      tx.pedido.findUnique.mockResolvedValue(null);

      await expect(service.crear(TENANT_ID, DTO)).rejects.toThrow(
        NotFoundException,
      );
      expect(gateway.cobrar).not.toHaveBeenCalled();
    });

    it('pedido ya pagado => 409, con otra clave no se puede cobrar dos veces', async () => {
      tx.pago.findFirst.mockResolvedValue({ id: 'otro', estado: 'APROBADO' });

      await expect(service.crear(TENANT_ID, DTO)).rejects.toThrow(
        new ConflictException('Este pedido ya fue pagado'),
      );
      expect(gateway.cobrar).not.toHaveBeenCalled();
    });

    it('hay un pago PENDIENTE sin resolver => 409 (podría ser un doble cobro)', async () => {
      tx.pago.findFirst.mockResolvedValue({ id: 'otro', estado: 'PENDIENTE' });

      await expect(service.crear(TENANT_ID, DTO)).rejects.toThrow(
        new ConflictException('Ya hay un pago en curso para este pedido'),
      );
      expect(gateway.cobrar).not.toHaveBeenCalled();
    });

    it('pedido sin líneas (monto 0) => 400', async () => {
      tx.pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        mesaId: MESA_ID,
        lineas: [],
      });

      await expect(service.crear(TENANT_ID, DTO)).rejects.toThrow(
        BadRequestException,
      );
      expect(gateway.cobrar).not.toHaveBeenCalled();
    });

    it('un pago RECHAZADO anterior no bloquea un nuevo intento con otra clave', async () => {
      // findFirst solo busca APROBADO/PENDIENTE: los RECHAZADO quedan afuera.
      await service.crear(TENANT_ID, { ...DTO, idempotencyKey: 'pago-002' });

      expect(tx.pago.findFirst).toHaveBeenCalledWith({
        where: {
          pedidoId: PEDIDO_ID,
          estado: { in: ['APROBADO', 'PENDIENTE'] },
        },
      });
      expect(gateway.cobrar).toHaveBeenCalled();
    });
  });

  describe('rechazo de la tarjeta (BL-77: fondos insuficientes => mensaje claro, sin cargo)', () => {
    beforeEach(() => {
      gateway.cobrar.mockResolvedValue({
        aprobado: false,
        pasarelaReferencia: 'ORD-FALLIDA',
        motivoRechazo: 'insufficient_amount',
      });
    });

    it('guarda el pago como RECHAZADO con la referencia y devuelve la mesa a OCUPADA', async () => {
      await service.crear(TENANT_ID, DTO).catch(() => undefined);

      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: PAGO_ID },
        data: { estado: 'RECHAZADO', pasarelaReferencia: 'ORD-FALLIDA' },
      });
      expect(estadosDeMesa()).toEqual(['EN_PROCESO_DE_PAGO', 'OCUPADA']);
    });

    it('le responde al comensal un 402 con el motivo y un mensaje claro', async () => {
      const error = await service.crear(TENANT_ID, DTO).catch((e) => e);

      expect(error).toBeInstanceOf(PagoRechazadoException);
      expect(error.getStatus()).toBe(402);
      expect(error.getResponse()).toMatchObject({
        motivo: 'insufficient_amount',
        message: expect.stringContaining('fondos suficientes'),
      });
      expect(error.getResponse().message).toContain(
        'No se realizó ningún cargo',
      );
    });

    it('un motivo desconocido igual da un mensaje genérico claro', async () => {
      gateway.cobrar.mockResolvedValue({
        aprobado: false,
        pasarelaReferencia: 'ORD-X',
        motivoRechazo: 'motivo_nuevo',
      });

      const error = await service.crear(TENANT_ID, DTO).catch((e) => e);

      expect(error.getResponse().message).toContain(
        'No se realizó ningún cargo',
      );
    });
  });

  describe('pago pendiente (la pasarela todavía no resolvió)', () => {
    it('queda PENDIENTE, no rechaza ni libera la mesa, y devuelve el pago', async () => {
      gateway.cobrar.mockResolvedValue({
        aprobado: false,
        pendiente: true,
        pasarelaReferencia: 'ORD-P',
      });

      const pago = await service.crear(TENANT_ID, DTO);

      expect(pago).toMatchObject({
        estado: 'PENDIENTE',
        pasarelaReferencia: 'ORD-P',
      });
      expect(estadosDeMesa()).toEqual(['EN_PROCESO_DE_PAGO']); // sigue en proceso
    });
  });

  describe('modo degradado (BL-77: pasarela caída o lenta)', () => {
    it('lanza el 503 y deja el pago PENDIENTE con la mesa EN_PROCESO_DE_PAGO, para reconciliar', async () => {
      gateway.cobrar.mockRejectedValue(
        new PagoTemporalmenteNoDisponibleException(),
      );

      await expect(service.crear(TENANT_ID, DTO)).rejects.toThrow(
        PagoTemporalmenteNoDisponibleException,
      );

      // El pago ya se había guardado en la Fase 1 y NO se lo marca rechazado:
      // no sabemos si la pasarela llegó a cobrar.
      expect(tx.pago.create).toHaveBeenCalledTimes(1);
      expect(tx.pago.update).not.toHaveBeenCalled();
      expect(estadosDeMesa()).toEqual(['EN_PROCESO_DE_PAGO']);
    });

    it('el pago PENDIENTE reservado se confirma antes de llamar a la pasarela (no se pierde por un rollback)', async () => {
      const ordenDeEventos: string[] = [];
      tenantPrisma.runInTenantContext.mockImplementation(async (_t, cb) => {
        const resultado = await cb(tx);
        ordenDeEventos.push('transaccion-confirmada');
        return resultado;
      });
      gateway.cobrar.mockImplementation(async () => {
        ordenDeEventos.push('cobro');
        throw new PagoTemporalmenteNoDisponibleException();
      });

      await service.crear(TENANT_ID, DTO).catch(() => undefined);

      expect(ordenDeEventos).toEqual(['transaccion-confirmada', 'cobro']);
    });
  });

  describe('error de la pasarela (respondió con un error, no hubo cobro)', () => {
    it('marca el pago RECHAZADO, devuelve la mesa a OCUPADA y propaga el error', async () => {
      const error = new BadGatewayException(
        'Mercado Pago no pudo procesar el pago',
      );
      gateway.cobrar.mockRejectedValue(error);

      await expect(service.crear(TENANT_ID, DTO)).rejects.toBe(error);

      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: PAGO_ID },
        data: { estado: 'RECHAZADO' },
      });
      expect(estadosDeMesa()).toEqual(['EN_PROCESO_DE_PAGO', 'OCUPADA']);
    });

    it('dato inválido del cliente (ej. token de tarjeta vencido) => 400 y el pago no queda colgado', async () => {
      const error = new BadRequestException(
        'Los datos de la tarjeta no son válidos',
      );
      gateway.cobrar.mockRejectedValue(error);

      await expect(service.crear(TENANT_ID, DTO)).rejects.toBe(error);

      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: PAGO_ID },
        data: { estado: 'RECHAZADO' },
      });
    });

    it('un error inesperado (no HTTP, ej. red) no se marca rechazado: el resultado es incierto', async () => {
      gateway.cobrar.mockRejectedValue(new TypeError('fetch failed'));

      await expect(service.crear(TENANT_ID, DTO)).rejects.toThrow(
        'fetch failed',
      );

      expect(tx.pago.update).not.toHaveBeenCalled();
    });
  });
});
