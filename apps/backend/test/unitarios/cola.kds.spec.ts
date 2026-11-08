import { PedidoEstado } from '@prisma/client';
import {
  calcularMinutosEstimados,
  estadoDeLaCola,
} from '../../src/pedidos/cola-kds';

// HU-042 (BL-464): estado de la cola del KDS y tiempo estimado (ADR 0010).

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('calcularMinutosEstimados', () => {
  it('[TC-U-384] un pedido ya en preparación (posición 0) tarda el tiempo de referencia', () => {
    expect(calcularMinutosEstimados(0, 5, 15)).toBe(15);
  });

  it('[TC-U-385] el tiempo crece con la posición en la cola, en proporción al límite', () => {
    // 15 × (1 + 1/5) = 18; 15 × (1 + 5/5) = 30; 15 × (1 + 10/5) = 45.
    expect(calcularMinutosEstimados(1, 5, 15)).toBe(18);
    expect(calcularMinutosEstimados(5, 5, 15)).toBe(30);
    expect(calcularMinutosEstimados(10, 5, 15)).toBe(45);
  });

  it('[TC-U-386] redondea hacia arriba para no prometer menos de lo real', () => {
    // 15 × (1 + 1/4) = 18.75 → 19.
    expect(calcularMinutosEstimados(1, 4, 15)).toBe(19);
  });
});

describe('estadoDeLaCola', () => {
  let tx: any;

  beforeEach(() => {
    tx = {
      restaurante: { findUnique: jest.fn() },
      pedido: { count: jest.fn(), findMany: jest.fn() },
    };
  });

  it('[TC-U-387] con la cola desactivada devuelve activa=false y no consulta pedidos', async () => {
    tx.restaurante.findUnique.mockResolvedValue({
      limitePedidosEnPreparacion: null,
      umbralAlertaCola: 10,
      minutosPreparacionEstimados: 15,
    });

    const estado = await estadoDeLaCola(tx, TENANT_ID);

    expect(estado).toEqual({
      activa: false,
      limite: null,
      enPreparacion: 0,
      enEspera: 0,
      umbralAlerta: 10,
      altaDemanda: false,
      minutosEstimados: 15,
      orden: [],
    });
    expect(tx.pedido.count).not.toHaveBeenCalled();
    expect(tx.pedido.findMany).not.toHaveBeenCalled();
  });

  it('[TC-U-388] con la cola activa numera los pedidos en espera en orden FIFO, con su tiempo', async () => {
    tx.restaurante.findUnique.mockResolvedValue({
      limitePedidosEnPreparacion: 5,
      umbralAlertaCola: 10,
      minutosPreparacionEstimados: 15,
    });
    tx.pedido.count.mockResolvedValue(5);
    tx.pedido.findMany.mockResolvedValue([
      { id: 'PED-101' },
      { id: 'PED-102' },
    ]);

    const estado = await estadoDeLaCola(tx, TENANT_ID);

    expect(tx.pedido.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, estado: PedidoEstado.RECIBIDO },
      orderBy: [
        { encoladoEn: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
      ],
      select: { id: true },
    });
    expect(estado).toEqual({
      activa: true,
      limite: 5,
      enPreparacion: 5,
      enEspera: 2,
      umbralAlerta: 10,
      altaDemanda: false,
      // El próximo que llegue queda tercero: 15 × (1 + 3/5) = 24.
      minutosEstimados: 24,
      orden: [
        { pedidoId: 'PED-101', posicion: 1, minutosEstimados: 18 },
        { pedidoId: 'PED-102', posicion: 2, minutosEstimados: 21 },
      ],
    });
  });

  it('[TC-U-389] alta demanda solo cuando la cola SUPERA el umbral (10 no, 11 sí)', async () => {
    tx.restaurante.findUnique.mockResolvedValue({
      limitePedidosEnPreparacion: 5,
      umbralAlertaCola: 10,
      minutosPreparacionEstimados: 15,
    });
    tx.pedido.count.mockResolvedValue(5);
    const cola = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `PED-${i}` }));

    tx.pedido.findMany.mockResolvedValueOnce(cola(10));
    expect((await estadoDeLaCola(tx, TENANT_ID)).altaDemanda).toBe(false);

    tx.pedido.findMany.mockResolvedValueOnce(cola(11));
    expect((await estadoDeLaCola(tx, TENANT_ID)).altaDemanda).toBe(true);
  });
});
