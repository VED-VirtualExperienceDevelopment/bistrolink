import {
  cantidadesPorItem,
  compararAlertas,
  disponibleTrasAjuste,
  faltaStock,
  tipoAlerta,
} from '../../src/stock/estado-stock';

// HU-015 (BL-120): reglas del stock de un ítem.

const item = (
  controlaStock: boolean,
  stockActual: number,
  umbralAlerta = 5,
) => ({
  controlaStock,
  stockActual,
  umbralAlerta,
});

describe('estado del stock', () => {
  it('[TC-U-324] alerta: agotado en 0, por agotarse en o debajo del umbral, nada arriba del umbral o sin control de stock', () => {
    expect(tipoAlerta(item(true, 0))).toBe('AGOTADO');
    expect(tipoAlerta(item(true, 1))).toBe('STOCK_CRITICO');
    expect(tipoAlerta(item(true, 5))).toBe('STOCK_CRITICO');
    expect(tipoAlerta(item(true, 6))).toBeNull();
    expect(tipoAlerta(item(false, 0))).toBeNull();
    // Umbral 0: solo avisa al agotarse.
    expect(tipoAlerta(item(true, 1, 0))).toBeNull();
  });

  it('[TC-U-325] con control de stock, la disponibilidad sigue al stock; sin control, queda como estaba', () => {
    expect(disponibleTrasAjuste(item(true, 0), true)).toBe(false);
    expect(disponibleTrasAjuste(item(true, 3), false)).toBe(true);
    expect(disponibleTrasAjuste(item(false, 0), true)).toBe(true);
    expect(disponibleTrasAjuste(item(false, 10), false)).toBe(false);
  });

  it('[TC-U-326] la campana ordena los agotados primero y después por menos stock', () => {
    const alertas = [
      { tipo: 'STOCK_CRITICO' as const, stockActual: 4, nombre: 'Flan' },
      { tipo: 'AGOTADO' as const, stockActual: 0, nombre: 'Milanesa' },
      { tipo: 'STOCK_CRITICO' as const, stockActual: 1, nombre: 'Chivito' },
    ];

    expect(alertas.sort(compararAlertas).map((a) => a.nombre)).toEqual([
      'Milanesa',
      'Chivito',
      'Flan',
    ]);
  });

  it('[TC-U-349] suma las líneas del mismo ítem y arma el mensaje del 409 solo si no alcanza', () => {
    expect(
      cantidadesPorItem([
        { itemCartaId: 'a', cantidad: 2 },
        { itemCartaId: 'b', cantidad: 1 },
        { itemCartaId: 'a', cantidad: 3 },
      ]),
    ).toEqual(
      new Map([
        ['a', 5],
        ['b', 1],
      ]),
    );
    const milanesa = { ...item(true, 2), nombre: 'Milanesa' };
    expect(faltaStock(milanesa, 2)).toBeNull();
    expect(faltaStock(milanesa, 3)).toBe(
      'No hay stock suficiente de "Milanesa": quedan 2',
    );
    expect(faltaStock({ ...milanesa, stockActual: 0 }, 1)).toBe(
      '"Milanesa" está agotado',
    );
    expect(faltaStock({ ...milanesa, controlaStock: false }, 99)).toBeNull();
  });
});
