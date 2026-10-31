import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoriaDto } from '../../src/menu/dto/create-categoria.dto';
import { UpdateCategoriaDto } from '../../src/menu/dto/update-categoria.dto';
import { CambiarDisponibilidadDto } from '../../src/menu/dto/cambiar-disponibilidad.dto';

/** BL-395: DTOs de la categoría (hallazgo C6) y de la disponibilidad. */

const errores = async <T extends object>(clase: new () => T, plano: object) =>
  (await validate(plainToInstance(clase, plano))).map((e) => e.property);

describe('CreateCategoriaDto (BL-395)', () => {
  it('[TC-U-179] acepta nombre, descripción y orden', async () => {
    expect(
      await errores(CreateCategoriaDto, {
        nombre: 'Picadas',
        descripcion: 'Para compartir',
        orden: 2,
      }),
    ).toEqual([]);
  });

  it('[TC-U-179] acepta solo el nombre', async () => {
    expect(await errores(CreateCategoriaDto, { nombre: 'Postres' })).toEqual(
      [],
    );
  });

  it.each([[''], ['   '], [undefined], [123]])(
    '[TC-U-180] rechaza el nombre %p',
    async (nombre) => {
      expect(await errores(CreateCategoriaDto, { nombre })).toEqual(['nombre']);
    },
  );

  it('[TC-U-180] rechaza un nombre de más de 60 caracteres', async () => {
    expect(
      await errores(CreateCategoriaDto, { nombre: 'a'.repeat(61) }),
    ).toEqual(['nombre']);
  });

  it('[TC-U-180] rechaza una descripción de más de 200 caracteres', async () => {
    expect(
      await errores(CreateCategoriaDto, {
        nombre: 'Picadas',
        descripcion: 'a'.repeat(201),
      }),
    ).toEqual(['descripcion']);
  });

  it('[TC-U-180] rechaza un orden negativo', async () => {
    expect(
      await errores(CreateCategoriaDto, { nombre: 'Picadas', orden: -1 }),
    ).toEqual(['orden']);
  });

  it('[TC-U-181] quita los espacios del principio y del final', () => {
    const dto = plainToInstance(CreateCategoriaDto, {
      nombre: '  Picadas  ',
      descripcion: ' Para compartir ',
    });
    expect(dto.nombre).toBe('Picadas');
    expect(dto.descripcion).toBe('Para compartir');
  });
});

describe('UpdateCategoriaDto (BL-395)', () => {
  it('[TC-U-182] acepta cambiar solo la visibilidad', async () => {
    expect(await errores(UpdateCategoriaDto, { activo: false })).toEqual([]);
  });

  it('[TC-U-182] acepta cambiar nombre y descripción', async () => {
    expect(
      await errores(UpdateCategoriaDto, {
        nombre: 'Tablas',
        descripcion: 'Al mediodía',
      }),
    ).toEqual([]);
  });

  it.each([[''], ['   ']])(
    '[TC-U-183] rechaza renombrar a %p',
    async (nombre) => {
      expect(await errores(UpdateCategoriaDto, { nombre })).toEqual(['nombre']);
    },
  );
});

describe('CambiarDisponibilidadDto (BL-395)', () => {
  it.each([[true], [false]])('[TC-U-184] acepta %p', async (disponible) => {
    expect(await errores(CambiarDisponibilidadDto, { disponible })).toEqual([]);
  });

  it.each([[undefined], ['true'], [1], [null]])(
    '[TC-U-184] rechaza %p',
    async (disponible) => {
      expect(await errores(CambiarDisponibilidadDto, { disponible })).toEqual([
        'disponible',
      ]);
    },
  );
});
