import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUsuarioDto } from '../../src/usuarios/dto/create-usuario.dto';

/** BL-361: nombre y apellido obligatorios en el alta de usuarios. */

const VALIDO = {
  username: 'mozo-nuevo',
  nombre: 'Juan',
  apellido: 'Pérez',
  rol: 'MOZO',
  restauranteId: '22222222-2222-2222-2222-222222222222',
};

const errores = async (plano: object) =>
  (await validate(plainToInstance(CreateUsuarioDto, plano))).map(
    (e) => e.property,
  );

describe('CreateUsuarioDto: nombre y apellido (BL-361)', () => {
  it('[TC-U-048] acepta un alta con nombre y apellido', async () => {
    expect(await errores(VALIDO)).toEqual([]);
  });

  it.each(['nombre', 'apellido'])(
    '[TC-U-049] rechaza el alta sin %s',
    async (campo) => {
      const sinCampo: Record<string, string> = { ...VALIDO };
      delete sinCampo[campo];
      expect(await errores(sinCampo)).toEqual([campo]);
    },
  );

  it.each([
    'María José',
    "O'Neill",
    'D’Alessandro',
    'Pérez-Núñez',
    'Ñandú',
    'J.',
  ])('[TC-U-050] acepta el nombre %p', async (nombre) => {
    expect(await errores({ ...VALIDO, nombre, apellido: nombre })).toEqual([]);
  });

  it.each([
    '',
    '   ',
    '123',
    '-Juan',
    'Juan2',
    'Juan & Ana',
    'Ana/Luis',
    '<b>Juan</b>',
  ])('[TC-U-051] rechaza el nombre %p', async (nombre) => {
    expect(await errores({ ...VALIDO, nombre })).toEqual(['nombre']);
  });

  it('[TC-U-052] rechaza un nombre de más de 60 caracteres y acepta uno de 60', async () => {
    expect(await errores({ ...VALIDO, nombre: 'a'.repeat(61) })).toEqual([
      'nombre',
    ]);
    expect(await errores({ ...VALIDO, nombre: 'a'.repeat(60) })).toEqual([]);
  });

  it('[TC-U-053] limpia los espacios de más antes de validar y guardar', async () => {
    const dto = plainToInstance(CreateUsuarioDto, {
      ...VALIDO,
      nombre: '  María   José ',
      apellido: ' Pérez ',
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.nombre).toBe('María José');
    expect(dto.apellido).toBe('Pérez');
  });
});
