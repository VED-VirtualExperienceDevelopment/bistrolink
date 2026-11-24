import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ElegirPropinaDto } from '../../src/pagos/propina/elegir-propina.dto';
import { PropinaPedidoService } from '../../src/pagos/propina/propina-pedido.service';

// HU-022 (BL-494, BL-85, BL-86): el comensal elige la propina antes de pagar.

const TENANT = '11111111-1111-1111-1111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';

function pedido(overrides: Record<string, unknown> = {}) {
  return {
    estado: 'PENDIENTE_PAGO',
    // consumo $ 1.250
    lineas: [
      { subtotal: new Prisma.Decimal('800') },
      { subtotal: new Prisma.Decimal('450') },
    ],
    pagos: [],
    ...overrides,
  };
}

describe('PropinaPedidoService (HU-022, BL-494)', () => {
  let tx: { pedido: { findUnique: jest.Mock; update: jest.Mock } };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let service: PropinaPedidoService;

  beforeEach(() => {
    tx = {
      pedido: {
        findUnique: jest.fn().mockResolvedValue(pedido()),
        update: jest.fn(),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    service = new PropinaPedidoService(tenantPrisma as any);
  });

  const elegir = (dto: ElegirPropinaDto) => service.elegir(TENANT, PEDIDO, dto);

  it('guarda el porcentaje en el pedido, dentro del tenant (RLS), y devuelve lo calculado por el backend', async () => {
    const r = await elegir({ porcentaje: 15 });

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT,
      expect.any(Function),
    );
    expect(tx.pedido.update).toHaveBeenCalledWith({
      where: { id: PEDIDO },
      data: { propinaPorcentaje: 15, propinaMonto: null },
    });
    expect(r).toEqual({
      pedidoId: PEDIDO,
      propinaPorcentaje: 15,
      propinaMonto: null,
      consumo: '1250.00',
      propina: '188.00',
      total: '1438.00',
    });
  });

  it('guarda el monto libre', async () => {
    const r = await elegir({ monto: 200 });

    expect(tx.pedido.update).toHaveBeenCalledWith({
      where: { id: PEDIDO },
      data: { propinaPorcentaje: null, propinaMonto: 200 },
    });
    expect(r.propina).toBe('200.00');
    expect(r.total).toBe('1450.00');
  });

  it('sin porcentaje ni monto: borra la elección (sin propina)', async () => {
    const r = await elegir({});

    expect(tx.pedido.update).toHaveBeenCalledWith({
      where: { id: PEDIDO },
      data: { propinaPorcentaje: null, propinaMonto: null },
    });
    expect(r.propina).toBe('0.00');
    expect(r.total).toBe('1250.00');
  });

  it('null explícito en los dos campos: también es sin propina', async () => {
    const r = await elegir({ porcentaje: null, monto: null });

    expect(tx.pedido.update).toHaveBeenCalledWith({
      where: { id: PEDIDO },
      data: { propinaPorcentaje: null, propinaMonto: null },
    });
    expect(r.propina).toBe('0.00');
  });

  it('cambiar de porcentaje a monto reemplaza la elección anterior', async () => {
    await elegir({ porcentaje: 10 });
    await elegir({ monto: 300 });

    expect(tx.pedido.update).toHaveBeenLastCalledWith({
      where: { id: PEDIDO },
      data: { propinaPorcentaje: null, propinaMonto: 300 },
    });
  });

  it('un monto igual al consumo llega justo al tope y se acepta', async () => {
    const r = await elegir({ monto: 1250 });

    expect(r.propina).toBe('1250.00');
    expect(r.total).toBe('2500.00');
  });

  it('un monto mayor al consumo: 400 y no guarda nada', async () => {
    await expect(elegir({ monto: 1251 })).rejects.toThrow(BadRequestException);
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });

  it('con centavos en el consumo, el tope es el consumo en pesos enteros hacia abajo', async () => {
    tx.pedido.findUnique.mockResolvedValue(
      pedido({ lineas: [{ subtotal: new Prisma.Decimal('1250.90') }] }),
    );

    await expect(elegir({ monto: 1251 })).rejects.toThrow(BadRequestException);
    expect(tx.pedido.update).not.toHaveBeenCalled();

    const r = await elegir({ monto: 1250 });
    expect(r.propina).toBe('1250.00');
    expect(r.total).toBe('2500.90');
  });

  it('porcentaje y monto juntos: 400, sin tocar la base', async () => {
    await expect(elegir({ porcentaje: 10, monto: 200 })).rejects.toThrow(
      BadRequestException,
    );
    expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
  });

  it('pedido inexistente en el tenant: 404', async () => {
    tx.pedido.findUnique.mockResolvedValue(null);

    await expect(elegir({ porcentaje: 10 })).rejects.toThrow(NotFoundException);
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });

  it('pedido cancelado: 409', async () => {
    tx.pedido.findUnique.mockResolvedValue(pedido({ estado: 'CANCELADO' }));

    await expect(elegir({ porcentaje: 10 })).rejects.toThrow(ConflictException);
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });

  it('pedido que ya no espera el pago: 409', async () => {
    tx.pedido.findUnique.mockResolvedValue(pedido({ estado: 'RECIBIDO' }));

    await expect(elegir({ porcentaje: 10 })).rejects.toThrow(ConflictException);
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });

  it('con un pago con tarjeta en curso: 409, para no cambiar el monto en pleno cobro', async () => {
    tx.pedido.findUnique.mockResolvedValue(pedido({ pagos: [{ id: 'p1' }] }));

    await expect(elegir({ porcentaje: 10 })).rejects.toThrow(ConflictException);
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });
});

describe('ElegirPropinaDto (HU-022, BL-86)', () => {
  const errores = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(ElegirPropinaDto, body))).map(
      (e) => e.property,
    );

  it('acepta porcentajes enteros de 1 a 100', async () => {
    for (const porcentaje of [1, 15, 100]) {
      expect(await errores({ porcentaje })).toEqual([]);
    }
  });

  it('acepta un monto entero desde $ 1', async () => {
    for (const monto of [1, 200, 99_999_999]) {
      expect(await errores({ monto })).toEqual([]);
    }
  });

  it('acepta el body vacío y los nulos (sin propina)', async () => {
    expect(await errores({})).toEqual([]);
    expect(await errores({ porcentaje: null, monto: null })).toEqual([]);
  });

  it('rechaza porcentajes fuera de 1 a 100 o con decimales', async () => {
    for (const porcentaje of [0, 101, -5, 10.5, '10']) {
      expect(await errores({ porcentaje })).toEqual(['porcentaje']);
    }
  });

  it('rechaza montos de $ 0, con decimales, demasiado altos o que no son número', async () => {
    for (const monto of [0, -1, 1.5, 100_000_000, 'abc']) {
      expect(await errores({ monto })).toEqual(['monto']);
    }
  });
});
