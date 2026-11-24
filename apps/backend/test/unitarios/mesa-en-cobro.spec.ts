import { liberarMesaDelCobro } from '../../src/pagos/mesa-en-cobro';

// HU-017 (BL-60): la mesa sale de EN_PROCESO_DE_PAGO solo cuando no queda
// ningún cobro en curso en ella.

const MESA_ID = '33333333-3333-3333-3333-333333333333';

describe('liberarMesaDelCobro', () => {
  let tx: {
    $queryRaw: jest.Mock;
    pago: { count: jest.Mock };
    mesa: { updateMany: jest.Mock };
  };
  const orden: string[] = [];

  beforeEach(() => {
    orden.length = 0;
    tx = {
      $queryRaw: jest.fn(async () => {
        orden.push('bloqueo');
        return [];
      }),
      pago: {
        count: jest.fn(async () => {
          orden.push('count');
          return 0;
        }),
      },
      mesa: {
        updateMany: jest.fn(async () => {
          orden.push('updateMany');
          return { count: 1 };
        }),
      },
    };
  });

  const liberar = () => liberarMesaDelCobro(tx as any, MESA_ID);

  it('sin otros cobros en curso: la mesa vuelve a OCUPADA', async () => {
    expect(await liberar()).toBe(true);
    expect(tx.mesa.updateMany).toHaveBeenCalledWith({
      where: { id: MESA_ID, estado: 'EN_PROCESO_DE_PAGO' },
      data: { estado: 'OCUPADA' },
    });
  });

  it('cuenta los pagos PENDIENTES de todos los pedidos de la mesa', async () => {
    await liberar();

    expect(tx.pago.count).toHaveBeenCalledWith({
      where: { estado: 'PENDIENTE', pedido: { mesaId: MESA_ID } },
    });
  });

  it('otro comensal de la misma mesa tiene un cobro en curso: la mesa sigue cobrando', async () => {
    tx.pago.count.mockResolvedValue(1);

    expect(await liberar()).toBe(false);
    expect(tx.mesa.updateMany).not.toHaveBeenCalled();
  });

  it('la mesa ya no estaba cobrando (por ejemplo, se cerró): no hay nada que avisar', async () => {
    tx.mesa.updateMany.mockResolvedValue({ count: 0 });

    expect(await liberar()).toBe(false);
  });

  it('bloquea la fila de la mesa ANTES de contar (dos cobros que terminan a la vez)', async () => {
    await liberar();

    expect(orden).toEqual(['bloqueo', 'count', 'updateMany']);
    const [sql] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sql.join('?')).toContain('FOR UPDATE');
  });
});
