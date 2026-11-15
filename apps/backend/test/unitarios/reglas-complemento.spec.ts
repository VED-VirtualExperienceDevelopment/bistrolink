import {
  CONFIANZA_MINIMA,
  LIFT_MINIMO,
  MAXIMO_SUGERENCIAS,
  mejoresConsecuentes,
  MINIMO_PEDIDOS_CON_AMBOS,
  reglasDesdeConteos,
  VENTANA_REGLAS_DIAS,
} from '../../src/complementos/reglas-complemento';

/** HU-046 (BL-552): métricas y umbrales de las reglas de complemento. */

const conteos = (
  pedidos: number,
  porPlato: Record<string, number>,
  pares: [string, string, number][],
) => ({
  pedidos,
  pedidosPorPlato: new Map(Object.entries(porPlato)),
  pares: pares.map(([antecedenteId, consecuenteId, pedidosConAmbos]) => ({
    antecedenteId,
    consecuenteId,
    pedidosConAmbos,
  })),
});

describe('reglasDesdeConteos', () => {
  it('los parámetros del método: 90 días, 5 pedidos, confianza 0,2, lift > 1 y hasta 2 sugerencias', () => {
    expect(VENTANA_REGLAS_DIAS).toBe(90);
    expect(MINIMO_PEDIDOS_CON_AMBOS).toBe(5);
    expect(CONFIANZA_MINIMA).toBe(0.2);
    expect(LIFT_MINIMO).toBe(1);
    expect(MAXIMO_SUGERENCIAS).toBe(2);
  });

  it('calcula soporte, confianza y lift', () => {
    // 100 pedidos; milanesa en 20, flan en 10, los dos juntos en 8.
    const [regla] = reglasDesdeConteos(
      conteos(100, { milanesa: 20, flan: 10 }, [['milanesa', 'flan', 8]]),
    );
    expect(regla).toEqual({
      antecedenteId: 'milanesa',
      consecuenteId: 'flan',
      pedidosConAmbos: 8,
      soporte: 0.08,
      confianza: 0.4,
      lift: 4,
    });
  });

  it('con menos de 5 pedidos con los dos platos no hay regla (poco volumen)', () => {
    expect(
      reglasDesdeConteos(
        conteos(20, { milanesa: 4, flan: 4 }, [['milanesa', 'flan', 4]]),
      ),
    ).toEqual([]);
    expect(
      reglasDesdeConteos(
        conteos(20, { milanesa: 5, flan: 5 }, [['milanesa', 'flan', 5]]),
      ),
    ).toHaveLength(1);
  });

  it('con confianza menor a 0,2 no hay regla', () => {
    // 5 de 30 pedidos con milanesa: 0,1666…
    expect(
      reglasDesdeConteos(
        conteos(1000, { milanesa: 30, flan: 10 }, [['milanesa', 'flan', 5]]),
      ),
    ).toEqual([]);
    // 5 de 25: justo 0,2, sí.
    expect(
      reglasDesdeConteos(
        conteos(1000, { milanesa: 25, flan: 10 }, [['milanesa', 'flan', 5]]),
      ),
    ).toHaveLength(1);
  });

  it('con lift 1 o menos no hay regla: el flan se pide igual, con o sin milanesa', () => {
    // Confianza 0,5 y el flan está en la mitad de los pedidos: lift 1.
    expect(
      reglasDesdeConteos(
        conteos(20, { milanesa: 10, flan: 10 }, [['milanesa', 'flan', 5]]),
      ),
    ).toEqual([]);
    // Lift menor que 1.
    expect(
      reglasDesdeConteos(
        conteos(20, { milanesa: 10, flan: 16 }, [['milanesa', 'flan', 6]]),
      ),
    ).toEqual([]);
  });

  it('sin pedidos, sin el conteo de un plato o con un plato consigo mismo, no hay regla', () => {
    expect(
      reglasDesdeConteos(conteos(0, { a: 5, b: 5 }, [['a', 'b', 5]])),
    ).toEqual([]);
    expect(reglasDesdeConteos(conteos(50, { a: 5 }, [['a', 'b', 5]]))).toEqual(
      [],
    );
    expect(reglasDesdeConteos(conteos(50, { a: 5 }, [['a', 'a', 5]]))).toEqual(
      [],
    );
  });
});

describe('mejoresConsecuentes', () => {
  it('ordena por lift × confianza y devuelve hasta 2', () => {
    expect(
      mejoresConsecuentes([
        { consecuenteId: 'flan', confianza: 0.4, lift: 2 }, // 0,8
        { consecuenteId: 'agua', confianza: 0.3, lift: 4 }, // 1,2
        { consecuenteId: 'cafe', confianza: 0.2, lift: 1.5 }, // 0,3
      ]),
    ).toEqual(['agua', 'flan']);
  });

  it('se queda con la mejor regla de cada consecuente', () => {
    // Dos platos del pedido llevan al flan: cuenta la mejor (1,6), no dos veces.
    expect(
      mejoresConsecuentes([
        { consecuenteId: 'flan', confianza: 0.2, lift: 2 },
        { consecuenteId: 'agua', confianza: 0.5, lift: 2 },
        { consecuenteId: 'flan', confianza: 0.4, lift: 4 },
      ]),
    ).toEqual(['flan', 'agua']);
  });

  it('a igual puntaje ordena por id, y sin reglas no hay nada', () => {
    expect(
      mejoresConsecuentes(
        [
          { consecuenteId: 'b', confianza: 0.5, lift: 2 },
          { consecuenteId: 'a', confianza: 0.5, lift: 2 },
        ],
        3,
      ),
    ).toEqual(['a', 'b']);
    expect(mejoresConsecuentes([])).toEqual([]);
  });
});
