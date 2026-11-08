import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FiltrosReportesDto } from '../../src/reportes/dto/filtros-reportes.dto';

// HU-012 (BL-108): filtros de GET /admin/reportes (query string).

function validar(query: Record<string, string>) {
  const dto = plainToInstance(FiltrosReportesDto, query);
  return { dto, errores: validateSync(dto) };
}

describe('FiltrosReportesDto', () => {
  it('[TC-U-293] sin filtros: hoy y todos los canales', () => {
    const { dto, errores } = validar({});

    expect(errores).toHaveLength(0);
    expect(dto.periodo).toBe('HOY');
    expect(dto.canal).toBe('TODOS');
  });

  it('[TC-U-294] rechaza un período o un canal desconocidos', () => {
    const { errores } = validar({ periodo: 'SIEMPRE', canal: 'TELEFONO' });

    expect(errores.map((e) => e.property).sort()).toEqual(['canal', 'periodo']);
  });

  it('[TC-U-295] PERSONALIZADO exige desde y hasta con formato AAAA-MM-DD', () => {
    expect(validar({ periodo: 'PERSONALIZADO' }).errores).toHaveLength(2);
    expect(
      validar({
        periodo: 'PERSONALIZADO',
        desde: '01/11/2026',
        hasta: '2026-11-02',
      }).errores[0].property,
    ).toBe('desde');
    expect(
      validar({
        periodo: 'PERSONALIZADO',
        desde: '2026-11-01',
        hasta: '2026-11-02',
      }).errores,
    ).toHaveLength(0);
  });

  it('[TC-U-296] con otro período, desde y hasta no se validan (se ignoran)', () => {
    expect(
      validar({ periodo: 'HOY', desde: 'cualquier cosa' }).errores,
    ).toHaveLength(0);
  });
});
