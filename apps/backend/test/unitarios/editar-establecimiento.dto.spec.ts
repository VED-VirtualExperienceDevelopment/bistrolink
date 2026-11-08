import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EditarEstablecimientoDto } from '../../src/plataforma/dto/editar-establecimiento.dto';

/** BL-412: validación del PATCH de datos del establecimiento. */

async function errores(datos: object) {
  const dto = plainToInstance(EditarEstablecimientoDto, datos);
  const resultado = await validate(dto, { whitelist: true });
  return { dto, propiedades: resultado.map((e) => e.property) };
}

describe('EditarEstablecimientoDto (BL-412)', () => {
  it('todos los campos son opcionales', async () => {
    expect((await errores({})).propiedades).toEqual([]);
  });

  it('acepta datos válidos y limpia los espacios de más', async () => {
    const { dto, propiedades } = await errores({
      razonSocial: '  Uno   y Cía  SRL ',
      rut: '219999990016',
      plan: ' PRO_ANUAL ',
      restauranteNombre: ' Uno  Bistró ',
      restauranteDireccion: 'Calle 2',
    });

    expect(propiedades).toEqual([]);
    expect(dto.razonSocial).toBe('Uno y Cía SRL');
    expect(dto.plan).toBe('PRO_ANUAL');
    expect(dto.restauranteNombre).toBe('Uno Bistró');
  });

  it('rechaza un RUT con el dígito verificador mal (BL-409)', async () => {
    expect((await errores({ rut: '219999990017' })).propiedades).toEqual([
      'rut',
    ]);
  });

  it('rechaza el RUT con separadores (el frontend lo manda limpio)', async () => {
    expect((await errores({ rut: '21.999999.001-6' })).propiedades).toEqual([
      'rut',
    ]);
  });

  it('rechaza textos vacíos o solo con espacios', async () => {
    expect(
      (
        await errores({
          razonSocial: '   ',
          restauranteNombre: '',
          restauranteDireccion: ' ',
        })
      ).propiedades.sort(),
    ).toEqual(['razonSocial', 'restauranteDireccion', 'restauranteNombre']);
  });

  it('el plan va en mayúsculas, como código interno', async () => {
    expect((await errores({ plan: 'básico' })).propiedades).toEqual(['plan']);
    expect((await errores({ plan: 'Basico' })).propiedades).toEqual(['plan']);
  });

  it('respeta los largos máximos del alta', async () => {
    expect(
      (
        await errores({
          razonSocial: 'a'.repeat(201),
          restauranteNombre: 'a'.repeat(121),
          restauranteDireccion: 'a'.repeat(201),
        })
      ).propiedades.sort(),
    ).toEqual(['razonSocial', 'restauranteDireccion', 'restauranteNombre']);
  });
});
