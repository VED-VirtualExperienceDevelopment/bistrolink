import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrearPedidoItemDto } from '../../src/pedidos/dto/crear-pedido.dto';
import {
  sumarAceptadasEnTx,
  sumarMostradaEnTx,
} from '../../src/complementos/metricas-sugerencia';

/** HU-046 (BL-554): contadores de la sugerencia de complementos. */

const TENANT = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE = '22222222-2222-2222-2222-222222222222';
const PEDIDO = '33333333-3333-3333-3333-333333333333';

describe('metricas-sugerencia', () => {
  const tx = () => ({ $executeRaw: jest.fn().mockResolvedValue(1) });

  it('una mostrada suma 1 en el día del local y el canal, con parámetros', async () => {
    const t = tx();
    await sumarMostradaEnTx(t, TENANT, RESTAURANTE, 'QR');
    const { sql, values } = t.$executeRaw.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO metrica_sugerencia_dia');
    expect(sql).toContain('AT TIME ZONE r.timezone');
    expect(sql).toContain(
      'SET mostradas = metrica_sugerencia_dia.mostradas + 1',
    );
    expect(values).toEqual(['QR', RESTAURANTE, TENANT]);
    expect(sql).not.toContain(TENANT);
  });

  it('las aceptadas son las líneas del pedido agregadas desde la sugerencia, de platos sugeribles', async () => {
    const t = tx();
    await sumarAceptadasEnTx(t, TENANT, PEDIDO);
    const { sql, values } = t.$executeRaw.mock.calls[0][0];
    expect(sql).toContain('lp.desde_sugerencia');
    expect(sql).toContain('ic.sugerible');
    expect(sql).toContain(
      'SET aceptadas = metrica_sugerencia_dia.aceptadas + EXCLUDED.aceptadas',
    );
    expect(values).toEqual([TENANT, PEDIDO]);
    // Nada del comensal: ni nombres, ni contacto, ni el id del pedido en la
    // tabla (solo se usa para filtrar).
    expect(sql).not.toMatch(/retiro_|contacto|usuario/);
  });
});

describe('CrearPedidoItemDto: desdeSugerencia (HU-046, BL-554)', () => {
  const LINEA = {
    itemCartaId: '44444444-4444-4444-4444-444444444444',
    cantidad: 1,
  };
  const errores = async (plano: object) =>
    (await validate(plainToInstance(CrearPedidoItemDto, plano))).map(
      (e) => e.property,
    );

  it('es opcional y booleano', async () => {
    expect(await errores(LINEA)).toEqual([]);
    expect(await errores({ ...LINEA, desdeSugerencia: true })).toEqual([]);
    expect(await errores({ ...LINEA, desdeSugerencia: 'si' })).toEqual([
      'desdeSugerencia',
    ]);
  });
});
