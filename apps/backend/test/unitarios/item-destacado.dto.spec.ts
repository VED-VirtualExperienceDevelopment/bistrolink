import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemDto } from '../../src/menu/dto/create-item.dto';
import { UpdateItemDto } from '../../src/menu/dto/update-item.dto';

/** HU-044 (BL-537): «Sugerencia del local» en los DTOs del ítem. */

const errores = async <T extends object>(clase: new () => T, plano: object) =>
  (await validate(plainToInstance(clase, plano))).map((e) => e.property);

const ALTA = {
  categoriaId: '44444444-4444-4444-4444-444444444444',
  nombre: 'Flan casero',
  precio: '180',
};

describe('UpdateItemDto: destacado (HU-044)', () => {
  it.each([[true], [false]])('acepta destacado %p solo', async (destacado) => {
    expect(await errores(UpdateItemDto, { destacado })).toEqual([]);
  });

  it.each([['si'], [1], ['true']])(
    'rechaza destacado %p',
    async (destacado) => {
      expect(await errores(UpdateItemDto, { destacado })).toEqual([
        'destacado',
      ]);
    },
  );
});

describe('CreateItemDto: destacado (HU-044)', () => {
  it('es opcional y acepta un booleano', async () => {
    expect(await errores(CreateItemDto, ALTA)).toEqual([]);
    expect(await errores(CreateItemDto, { ...ALTA, destacado: true })).toEqual(
      [],
    );
  });

  it('rechaza un valor que no es booleano', async () => {
    expect(await errores(CreateItemDto, { ...ALTA, destacado: 'si' })).toEqual([
      'destacado',
    ]);
  });
});
