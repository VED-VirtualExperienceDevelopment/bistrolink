import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemDto } from '../../src/menu/dto/create-item.dto';
import { UpdateItemDto } from '../../src/menu/dto/update-item.dto';
import {
  camposCambiados,
  complementoDelPlato,
  MENSAJE_ALCOHOL_NO_SUGERIBLE,
} from '../../src/menu/menu-admin.service';

/** HU-046 (BL-551): platos sugeribles como complemento y con alcohol. */

const errores = async <T extends object>(clase: new () => T, plano: object) =>
  (await validate(plainToInstance(clase, plano))).map((e) => e.property);

const ALTA = {
  categoriaId: '44444444-4444-4444-4444-444444444444',
  nombre: 'Flan casero',
  precio: '180',
};

describe('HU-046 (BL-551): DTOs del plato', () => {
  it('sugerible y contieneAlcohol son opcionales y booleanos, en el alta y en la edición', async () => {
    expect(await errores(CreateItemDto, ALTA)).toEqual([]);
    expect(
      await errores(CreateItemDto, {
        ...ALTA,
        sugerible: true,
        contieneAlcohol: false,
      }),
    ).toEqual([]);
    expect(
      await errores(UpdateItemDto, { sugerible: false, contieneAlcohol: true }),
    ).toEqual([]);
  });

  it.each([['si'], [1], ['true']])('rechaza %p', async (valor) => {
    expect(await errores(UpdateItemDto, { sugerible: valor })).toEqual([
      'sugerible',
    ]);
    expect(
      await errores(CreateItemDto, { ...ALTA, contieneAlcohol: valor }),
    ).toEqual(['contieneAlcohol']);
  });
});

describe('HU-046 (BL-551): complementoDelPlato', () => {
  const NINGUNO = { sugerible: false, contieneAlcohol: false };
  const SUGERIBLE = { sugerible: true, contieneAlcohol: false };
  const CON_ALCOHOL = { sugerible: false, contieneAlcohol: true };

  it('sin ninguno de los dos campos no cambia nada', () => {
    expect(complementoDelPlato(SUGERIBLE, {})).toEqual({});
  });

  it('marca y desmarca la sugerencia de un plato sin alcohol', () => {
    expect(complementoDelPlato(NINGUNO, { sugerible: true })).toEqual(
      SUGERIBLE,
    );
    expect(complementoDelPlato(SUGERIBLE, { sugerible: false })).toEqual(
      NINGUNO,
    );
  });

  it('marcar «contiene alcohol» saca el plato de las sugerencias', () => {
    expect(complementoDelPlato(SUGERIBLE, { contieneAlcohol: true })).toEqual(
      CON_ALCOHOL,
    );
  });

  it('pedir que se sugiera un plato con alcohol es un 400 con un mensaje claro', () => {
    // El que ya tiene alcohol.
    expect(() => complementoDelPlato(CON_ALCOHOL, { sugerible: true })).toThrow(
      new BadRequestException(MENSAJE_ALCOHOL_NO_SUGERIBLE),
    );
    // Los dos a la vez.
    expect(() =>
      complementoDelPlato(NINGUNO, { sugerible: true, contieneAlcohol: true }),
    ).toThrow(BadRequestException);
  });

  it('se puede sugerir si en el mismo cambio se le saca el alcohol', () => {
    expect(
      complementoDelPlato(CON_ALCOHOL, {
        sugerible: true,
        contieneAlcohol: false,
      }),
    ).toEqual(SUGERIBLE);
  });

  it('desmarcar la sugerencia de un plato con alcohol no es un error', () => {
    expect(complementoDelPlato(CON_ALCOHOL, { sugerible: false })).toEqual(
      CON_ALCOHOL,
    );
  });
});

describe('HU-046 (BL-551): auditoría', () => {
  it('los cambios de sugerible y de contieneAlcohol quedan con antes y después', () => {
    expect(
      camposCambiados(
        { sugerible: true, contieneAlcohol: false, destacado: true },
        { sugerible: false, contieneAlcohol: true, destacado: true },
      ),
    ).toEqual({
      antes: { sugerible: true, contieneAlcohol: false },
      despues: { sugerible: false, contieneAlcohol: true },
    });
  });

  it('sin cambios (o sin el dato de antes) no registra nada', () => {
    expect(camposCambiados({ sugerible: true }, { sugerible: true })).toEqual({
      antes: {},
      despues: {},
    });
    expect(camposCambiados({}, { contieneAlcohol: true })).toEqual({
      antes: {},
      despues: {},
    });
  });
});
