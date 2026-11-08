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

describe('CreateUsuarioDto: nombre de usuario (BL-356, H-02)', () => {
  it.each(['mozo-nuevo', 'ana.perez', 'juan_2', 'abc', 'a'.repeat(30)])(
    '[TC-U-103] acepta el usuario %p',
    async (username) => {
      expect(await errores({ ...VALIDO, username })).toEqual([]);
    },
  );

  it.each([
    '12345678',
    '1ana',
    '-ana',
    '.ana',
    'ab',
    'a'.repeat(31),
    'ana perez',
    'ana@perez',
    'añil',
    '',
  ])('[TC-U-104] rechaza el usuario %p', async (username) => {
    expect(await errores({ ...VALIDO, username })).toEqual(['username']);
  });

  it('[TC-U-105] pasa el usuario a minúsculas y saca los espacios antes de validar', async () => {
    const dto = plainToInstance(CreateUsuarioDto, {
      ...VALIDO,
      username: '  Ana.Perez ',
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.username).toBe('ana.perez');
  });
});

describe('CreateUsuarioDto: largo del correo (BL-356)', () => {
  // Correo válido del largo pedido: usuario de 64 caracteres (el máximo que
  // admite IsEmail) y un dominio con etiquetas de hasta 63.
  const correo = (largo: number) => {
    const usuario = 'a'.repeat(64);
    const resto = largo - usuario.length - 1 - '.uy'.length;
    const etiquetas: string[] = [];
    for (let quedan = resto; quedan > 0; quedan -= 64) {
      etiquetas.push('b'.repeat(Math.min(63, quedan - (quedan > 63 ? 1 : 0))));
    }
    return `${usuario}@${etiquetas.join('.')}.uy`;
  };

  it('[TC-U-106] acepta un correo de 254 caracteres y rechaza uno de 255', async () => {
    expect(correo(254)).toHaveLength(254);
    expect(correo(255)).toHaveLength(255);
    expect(await errores({ ...VALIDO, email: correo(254) })).toEqual([]);
    expect(await errores({ ...VALIDO, email: correo(255) })).toEqual(['email']);
  });
});
