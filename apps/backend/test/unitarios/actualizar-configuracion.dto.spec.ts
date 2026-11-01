import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActualizarConfiguracionDto } from '../../src/configuracion/dto/actualizar-configuracion.dto';

/** HU-020 (BL-72): validación de PATCH /admin/configuracion. */

async function errores(body: Record<string, unknown>) {
  const dto = plainToInstance(ActualizarConfiguracionDto, body);
  const resultado = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return resultado.map((e) => e.property);
}

describe('ActualizarConfiguracionDto (HU-020, BL-72)', () => {
  it('acepta una configuración completa', async () => {
    expect(
      await errores({
        razonSocial: 'Uno SRL',
        efectivoHabilitado: false,
        mercadoPagoHabilitado: true,
        plexoHabilitado: false,
        handyHabilitado: false,
        propinasSugeridas: [10, 15, 20],
        cfeProveedor: 'SURTEC',
      }),
    ).toEqual([]);
  });

  it('acepta cambiar un solo campo', async () => {
    expect(await errores({ plexoHabilitado: false })).toEqual([]);
  });

  it('rechaza el RUT: lo cambia solo la plataforma (BL-412)', async () => {
    expect(await errores({ rut: '211234560019' })).toEqual(['rut']);
  });

  it('limpia los espacios de la razón social y no la acepta vacía', async () => {
    const dto = plainToInstance(ActualizarConfiguracionDto, {
      razonSocial: '  Uno   SRL ',
    });
    expect(dto.razonSocial).toBe('Uno SRL');
    expect(await errores({ razonSocial: '   ' })).toEqual(['razonSocial']);
  });

  it('rechaza habilitar Handy: quedó fuera del MVP', async () => {
    expect(await errores({ handyHabilitado: true })).toEqual([
      'handyHabilitado',
    ]);
    expect(await errores({ handyHabilitado: false })).toEqual([]);
  });

  it('los medios de pago son verdadero o falso', async () => {
    expect(await errores({ efectivoHabilitado: 'no' })).toEqual([
      'efectivoHabilitado',
    ]);
  });

  describe('propinas sugeridas', () => {
    it('las ordena de menor a mayor', () => {
      const dto = plainToInstance(ActualizarConfiguracionDto, {
        propinasSugeridas: [20, 10, 15],
      });
      expect(dto.propinasSugeridas).toEqual([10, 15, 20]);
    });

    it('acepta la lista vacía (sin sugerencias)', async () => {
      expect(await errores({ propinasSugeridas: [] })).toEqual([]);
    });

    it.each([
      ['un decimal', [12.5]],
      ['un cero', [0]],
      ['más de 100', [101]],
      ['repetidos', [10, 10]],
      ['más de 5', [5, 10, 15, 20, 25, 30]],
      ['algo que no es una lista', 10],
    ])('rechaza %s', async (_caso, propinasSugeridas) => {
      expect(await errores({ propinasSugeridas })).toEqual([
        'propinasSugeridas',
      ]);
    });
  });

  describe('proveedor de CFE', () => {
    it('acepta Surtec', async () => {
      expect(await errores({ cfeProveedor: 'SURTEC' })).toEqual([]);
    });

    it('rechaza Biller: quedó fuera del MVP', async () => {
      expect(await errores({ cfeProveedor: 'BILLER' })).toEqual([
        'cfeProveedor',
      ]);
    });
  });
});
