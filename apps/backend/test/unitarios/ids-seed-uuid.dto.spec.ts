import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemDto } from '../../src/menu/dto/create-item.dto';
import { UpdateItemDto } from '../../src/menu/dto/update-item.dto';
import { CreateUsuarioDto } from '../../src/usuarios/dto/create-usuario.dto';

/**
 * Los ids del seed del tenant A (restaurante 2222…, categorías 4444…) no son
 * UUID RFC 4122: el 4.º grupo no empieza con 8, 9, a ni b. Postgres y
 * ParseUUIDPipe los aceptan, así que los DTOs del body tienen que aceptarlos
 * también (@IsUUID('loose')). Mismo caso que TC-I-032 con el mapa de mesas.
 */

const CATEGORIA_BEBIDAS_SEED = '44444444-4444-4444-4444-444444444445';
const RESTAURANTE_A_SEED = '22222222-2222-2222-2222-222222222222';
const UUID_V4 = 'a46faef3-7412-45ae-af80-3829cd27b990';

async function errores(clase: any, datos: object, propiedad: string) {
  const dto = plainToInstance(clase, datos);
  const resultado = await validate(dto as object);
  return resultado.filter((e) => e.property === propiedad);
}

describe('ids del seed en los DTOs (@IsUUID loose)', () => {
  const itemBase = { nombre: 'Coca Zero 500cc', precio: '65' };

  it.each([CATEGORIA_BEBIDAS_SEED, UUID_V4])(
    'CreateItemDto acepta la categoría %s',
    async (categoriaId) => {
      expect(
        await errores(
          CreateItemDto,
          { ...itemBase, categoriaId },
          'categoriaId',
        ),
      ).toHaveLength(0);
    },
  );

  it('CreateItemDto sigue rechazando un id que no es UUID', async () => {
    expect(
      await errores(
        CreateItemDto,
        { ...itemBase, categoriaId: 'cat-123' },
        'categoriaId',
      ),
    ).toHaveLength(1);
  });

  it('UpdateItemDto acepta la categoría del seed', async () => {
    expect(
      await errores(
        UpdateItemDto,
        { categoriaId: CATEGORIA_BEBIDAS_SEED },
        'categoriaId',
      ),
    ).toHaveLength(0);
  });

  it('CreateUsuarioDto acepta el restaurante del seed', async () => {
    expect(
      await errores(
        CreateUsuarioDto,
        {
          username: 'mozo-nuevo',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_A_SEED,
        },
        'restauranteId',
      ),
    ).toHaveLength(0);
  });

  it('CreateUsuarioDto sigue rechazando un id que no es UUID', async () => {
    expect(
      await errores(
        CreateUsuarioDto,
        { username: 'mozo-nuevo', rol: 'MOZO', restauranteId: '2222' },
        'restauranteId',
      ),
    ).toHaveLength(1);
  });
});
