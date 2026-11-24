import {
  CANTIDAD_MAS_PEDIDOS,
  MINIMO_UNIDADES_MAS_PEDIDO,
  platosMasPedidos,
  VENTANA_MAS_PEDIDOS_DIAS,
} from '../../src/menu/mas-pedidos';

/** HU-045 (BL-547): insignia «Más pedido», con ventas reales. */

const TENANT = '11111111-1111-1111-1111-111111111111';
const AHORA = new Date('2026-11-14T15:00:00.000Z');

describe('platosMasPedidos', () => {
  const tx = (filas: { item_carta_id: string }[] = []) => ({
    $queryRaw: jest.fn().mockResolvedValue(filas),
  });

  it('los parámetros del método: 30 días, al menos 10 unidades y top 3', () => {
    expect(VENTANA_MAS_PEDIDOS_DIAS).toBe(30);
    expect(MINIMO_UNIDADES_MAS_PEDIDO).toBe(10);
    expect(CANTIDAD_MAS_PEDIDOS).toBe(3);
  });

  it('sin platos en la carta no consulta la base', async () => {
    const t = tx();
    await expect(platosMasPedidos(t, TENANT, [], AHORA)).resolves.toEqual([]);
    expect(t.$queryRaw).not.toHaveBeenCalled();
  });

  it('devuelve los ids en el orden del ranking', async () => {
    const t = tx([{ item_carta_id: 'b' }, { item_carta_id: 'a' }]);
    await expect(
      platosMasPedidos(t, TENANT, ['a', 'b', 'c'], AHORA),
    ).resolves.toEqual(['b', 'a']);
  });

  it('consulta con parámetros: tenant, desde hace 30 días, candidatos, umbral y top', async () => {
    const t = tx();
    await platosMasPedidos(t, TENANT, ['a', 'b'], AHORA);

    const sql = t.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual([
      TENANT,
      new Date('2026-10-15T15:00:00.000Z'),
      'a',
      'b',
      10,
      3,
    ]);
    // Agregado por plato, con umbral y desempate por la venta más reciente.
    expect(sql.sql).toMatch(/FROM resumen_platos_hora/);
    expect(sql.sql).toMatch(/HAVING SUM\(cantidad\) >= \?/);
    expect(sql.sql).toMatch(/ORDER BY SUM\(cantidad\) DESC, MAX\(hora\) DESC/);
  });
});
