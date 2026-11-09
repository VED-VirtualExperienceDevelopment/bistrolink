import { BadRequestException } from '@nestjs/common';
import {
  aplicaRotacion,
  canalesDelFiltro,
  diaEnZona,
  periodoAnterior,
  resolverPeriodo,
} from '../../src/reportes/periodos-reportes';

// HU-012 (BL-108): períodos y canales del dashboard de reportes.

const MONTEVIDEO = 'America/Montevideo';
// 3 de noviembre, 01:30 en UTC = 2 de noviembre, 22:30 en Montevideo.
const AHORA = new Date('2026-11-03T01:30:00.000Z');

describe('periodos del dashboard de reportes', () => {
  it('[TC-U-287] el día de hoy sale del calendario del local, no del servidor (UTC)', () => {
    expect(diaEnZona(AHORA, MONTEVIDEO)).toBe('2026-11-02');
    expect(resolverPeriodo('HOY', MONTEVIDEO, AHORA)).toEqual({
      desde: '2026-11-02',
      hasta: '2026-11-02',
    });
  });

  it.each([
    ['AYER', { desde: '2026-11-01', hasta: '2026-11-01' }],
    ['ULTIMOS_7_DIAS', { desde: '2026-10-27', hasta: '2026-11-02' }],
    ['MES_ACTUAL', { desde: '2026-11-01', hasta: '2026-11-02' }],
  ] as const)('[TC-U-288] %s', (periodo, esperado) => {
    expect(resolverPeriodo(periodo, MONTEVIDEO, AHORA)).toEqual(esperado);
  });

  it('[TC-U-289] PERSONALIZADO usa las fechas pedidas, también en el futuro (queda vacío)', () => {
    expect(
      resolverPeriodo('PERSONALIZADO', MONTEVIDEO, AHORA, {
        desde: '2027-01-01',
        hasta: '2027-01-31',
      }),
    ).toEqual({ desde: '2027-01-01', hasta: '2027-01-31' });
  });

  it.each([
    ['sin fechas', {}],
    ['con un día que no existe', { desde: '2026-02-30', hasta: '2026-03-01' }],
    [
      'con desde posterior a hasta',
      { desde: '2026-11-02', hasta: '2026-11-01' },
    ],
    ['de más de 366 días', { desde: '2025-01-01', hasta: '2026-01-02' }],
  ])('[TC-U-290] PERSONALIZADO %s => 400', (_caso, fechas) => {
    expect(() =>
      resolverPeriodo('PERSONALIZADO', MONTEVIDEO, AHORA, fechas),
    ).toThrow(BadRequestException);
  });

  it('[TC-U-291] el período anterior tiene los mismos días, justo antes', () => {
    expect(
      periodoAnterior({ desde: '2026-11-02', hasta: '2026-11-02' }),
    ).toEqual({ desde: '2026-11-01', hasta: '2026-11-01' });
    expect(
      periodoAnterior({ desde: '2026-10-27', hasta: '2026-11-02' }),
    ).toEqual({ desde: '2026-10-20', hasta: '2026-10-26' });
    expect(
      periodoAnterior({ desde: '2026-03-01', hasta: '2026-03-03' }),
    ).toEqual({ desde: '2026-02-26', hasta: '2026-02-28' });
  });

  it('[TC-U-292] canales: En el local = QR y mozo; Web; WhatsApp; Todos no filtra. La rotación solo aplica con el local', () => {
    expect(canalesDelFiltro('LOCAL')).toEqual(['QR', 'MOZO']);
    expect(canalesDelFiltro('WEB')).toEqual(['WEB']);
    expect(canalesDelFiltro('WHATSAPP')).toEqual(['WHATSAPP']);
    expect(canalesDelFiltro('POS')).toEqual(['POS']);
    expect(canalesDelFiltro('TODOS')).toBeNull();
    expect(aplicaRotacion('TODOS')).toBe(true);
    expect(aplicaRotacion('LOCAL')).toBe(true);
    expect(aplicaRotacion('WEB')).toBe(false);
    expect(aplicaRotacion('WHATSAPP')).toBe(false);
    expect(aplicaRotacion('POS')).toBe(false);
  });
});
