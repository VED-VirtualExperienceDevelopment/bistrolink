import {
  CANTIDAD_RESPALDO_EVALUACION,
  conteosDePedidos,
  evaluarReglas,
  sugerenciaConReglas,
  sugeriblesPorPopularidad,
} from '../../src/complementos/evaluacion-reglas';

/** HU-046 (BL-555): validación offline de las reglas (hit rate@2). */

const SUGERIBLES = new Set(['flan', 'agua', 'cafe']);
const repetir = (veces: number, pedido: string[]) =>
  Array.from({ length: veces }, () => pedido);

describe('conteosDePedidos', () => {
  it('cuenta pedidos, pedidos por plato (sin repetir) y pares hacia sugeribles con al menos 5', () => {
    const conteos = conteosDePedidos(
      [
        ...repetir(5, ['milanesa', 'flan', 'flan']),
        ...repetir(4, ['milanesa', 'agua']),
        [],
      ],
      SUGERIBLES,
    );
    expect(conteos.pedidos).toBe(9);
    expect(conteos.pedidosPorPlato.get('milanesa')).toBe(9);
    expect(conteos.pedidosPorPlato.get('flan')).toBe(5);
    // flan → milanesa no: la milanesa no es sugerible. milanesa → agua: 4.
    expect(conteos.pares).toEqual([
      { antecedenteId: 'milanesa', consecuenteId: 'flan', pedidosConAmbos: 5 },
    ]);
  });
});

describe('sugeriblesPorPopularidad', () => {
  it('ordena los sugeribles por pedidos y, a igual, por id', () => {
    const conteos = conteosDePedidos(
      [['agua'], ['agua'], ['cafe'], ['flan'], ['milanesa'], ['milanesa']],
      SUGERIBLES,
    );
    expect(sugeriblesPorPopularidad(conteos, SUGERIBLES)).toEqual([
      'agua',
      'cafe',
      'flan',
    ]);
  });
});

describe('sugerenciaConReglas', () => {
  const reglas = [
    {
      antecedenteId: 'milanesa',
      consecuenteId: 'flan',
      pedidosConAmbos: 5,
      soporte: 0.1,
      confianza: 0.5,
      lift: 2,
    },
  ];

  it('con una regla del pedido, sugiere por reglas', () => {
    expect(
      sugerenciaConReglas(reglas, new Set(['milanesa']), SUGERIBLES, ['agua']),
    ).toEqual(['flan']);
  });

  it('sin reglas, el más pedido de los candidatos (uno solo, como en producción)', () => {
    expect(CANTIDAD_RESPALDO_EVALUACION).toBe(1);
    expect(
      sugerenciaConReglas(
        reglas,
        new Set(['chivito']),
        new Set(['agua', 'cafe']),
        ['flan', 'agua', 'cafe'],
      ),
    ).toEqual(['agua']);
  });
});

describe('evaluarReglas', () => {
  // Entrenamiento: quien pide milanesa suele pedir flan y quien pide
  // chivito, agua (2 reglas). El agua es además lo más pedido en general.
  // Pizza → agua (4) y pizza → café (3) no llegan a 5 pedidos.
  const entrenamiento = [
    ...repetir(6, ['milanesa', 'flan']),
    ...repetir(10, ['chivito', 'agua']),
    ...repetir(4, ['pizza', 'agua']),
    ...repetir(3, ['pizza', 'cafe']),
  ];

  it('mide el hit rate@2 de las reglas y del baseline de popularidad en la semana de prueba', () => {
    const prueba = [
      ['milanesa', 'flan'], // reglas aciertan (flan); popularidad: agua y flan, acierta
      ['milanesa', 'cafe'], // reglas: flan, no; popularidad: agua y flan, no
      ['chivito', 'agua'], // regla chivito → agua, acierta; popularidad, acierta
      ['pizza', 'cafe'], // sin regla: respaldo agua, no; popularidad agua y flan, no
      ['flan'], // sin nada elegido antes: no se evalúa
      ['milanesa'], // sin sugerible: no se evalúa
    ];
    const resultado = evaluarReglas({
      entrenamiento,
      prueba,
      sugeribles: SUGERIBLES,
    });
    expect(resultado).toEqual({
      pedidosEntrenamiento: 23,
      reglas: 2,
      pedidosEvaluados: 4,
      aciertosReglas: 2,
      aciertosPopularidad: 2,
      hitRateReglas: 50,
      hitRatePopularidad: 50,
    });
  });

  it('las reglas le ganan al baseline cuando el complemento depende del plato', () => {
    const resultado = evaluarReglas({
      entrenamiento: [
        ...repetir(6, ['milanesa', 'cafe']),
        ...repetir(20, ['chivito', 'agua']),
        ...repetir(10, ['pizza', 'flan']),
      ],
      prueba: repetir(3, ['milanesa', 'cafe']),
      sugeribles: SUGERIBLES,
    });
    expect(resultado.hitRateReglas).toBe(100);
    expect(resultado.hitRatePopularidad).toBe(0);
  });

  it('sin pedidos de prueba, 0 % y sin dividir por cero', () => {
    expect(
      evaluarReglas({ entrenamiento, prueba: [], sugeribles: SUGERIBLES }),
    ).toMatchObject({
      pedidosEvaluados: 0,
      hitRateReglas: 0,
      hitRatePopularidad: 0,
    });
  });
});
