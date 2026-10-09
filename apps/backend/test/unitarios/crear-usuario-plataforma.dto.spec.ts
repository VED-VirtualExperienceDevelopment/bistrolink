import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrearUsuarioPlataformaDto } from '../../src/plataforma/dto/crear-usuario-plataforma.dto';

/** BL-163: formato de los usuarios de plataforma (dev-<nombre>-plataforma). */

const VALIDO = {
  username: 'dev-daiana-plataforma',
  email: 'daiana@ejemplo.com',
  nombre: 'Daiana',
  apellido: 'Prueba',
};

const errores = async (plano: object) =>
  (await validate(plainToInstance(CrearUsuarioPlataformaDto, plano))).map(
    (e) => e.property,
  );

describe('CrearUsuarioPlataformaDto (BL-163)', () => {
  it.each([
    'dev-daiana-plataforma',
    'dev-maria-jose-plataforma',
    'dev-eric2-plataforma',
  ])('acepta el username %p', async (username) => {
    expect(await errores({ ...VALIDO, username })).toEqual([]);
  });

  it.each([
    'daiana-plataforma',
    'dev-daiana',
    'dev--plataforma',
    'Dev-Daiana-plataforma',
    'dev-daiana-plataforma-x',
    'prueba-admin',
  ])('rechaza el username %p', async (username) => {
    expect(await errores({ ...VALIDO, username })).toEqual(['username']);
  });

  it.each(['email', 'nombre', 'apellido'])(
    'rechaza si falta %s',
    async (campo) => {
      const datos: Record<string, unknown> = { ...VALIDO };
      delete datos[campo];
      expect(await errores(datos)).toEqual([campo]);
    },
  );
});
