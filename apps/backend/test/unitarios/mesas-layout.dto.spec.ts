import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  COORDENADA_MAXIMA_MESA,
  DIMENSION_MAXIMA_MESA,
  MesaLayoutDto,
} from '../../src/mesas/dto/mesa-layout.dto';
import {
  GuardarLayoutDto,
  MesaLayoutItemDto,
} from '../../src/mesas/dto/guardar-layout.dto';
import { ListarLayoutQueryDto } from '../../src/mesas/dto/listar-layout-query.dto';

/**
 * HU-016 — validación del layout en el borde de la API (DTOs).
 *
 * Complementa mesas.service.spec.ts: el service asume que el layout ya llegó
 * validado por el ValidationPipe, así que las reglas de forma/rango del JSON
 * se prueban acá, con análisis de valores límite (Anexo 11 §9.3).
 */

const RESTAURANTE_ID = '22222222-2222-4222-8222-222222222222';
const MESA_ID = '33333333-3333-4333-8333-333333333333';

const LAYOUT_VALIDO = {
  x: 10,
  y: 20,
  forma: 'CIRCULO',
  ancho: 80,
  alto: 80,
  rotacion: 0,
};

// Mismas opciones que se esperan en el ValidationPipe global de main.ts.
// Si main.ts no las usa, los tests de "propiedades extra" de abajo dejan de
// representar el comportamiento real de la API (ver nota en el análisis).
const OPCIONES_PIPE = { whitelist: true, forbidNonWhitelisted: true };

async function validar<T extends object>(
  clase: new () => T,
  plano: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(plainToInstance(clase, plano), OPCIONES_PIPE);
}

function propiedadesConError(errores: ValidationError[]): string[] {
  return errores.map((e) => e.property);
}

describe('MesaLayoutDto (HU-016)', () => {
  it('acepta un layout válido', async () => {
    expect(await validar(MesaLayoutDto, LAYOUT_VALIDO)).toHaveLength(0);
  });

  it.each(['CIRCULO', 'CUADRADO', 'RECTANGULO'])(
    'acepta la forma %s',
    async (forma) => {
      expect(
        await validar(MesaLayoutDto, { ...LAYOUT_VALIDO, forma }),
      ).toHaveLength(0);
    },
  );

  it('rechaza una forma fuera del catálogo', async () => {
    const errores = await validar(MesaLayoutDto, {
      ...LAYOUT_VALIDO,
      forma: 'TRIANGULO',
    });
    expect(propiedadesConError(errores)).toEqual(['forma']);
  });

  describe('rotacion — valores límite [0, 359]', () => {
    it.each([0, 359])('acepta %p', async (rotacion) => {
      expect(
        await validar(MesaLayoutDto, { ...LAYOUT_VALIDO, rotacion }),
      ).toHaveLength(0);
    });

    it.each([-1, 360])('rechaza %p', async (rotacion) => {
      const errores = await validar(MesaLayoutDto, {
        ...LAYOUT_VALIDO,
        rotacion,
      });
      expect(propiedadesConError(errores)).toEqual(['rotacion']);
    });
  });

  describe.each(['ancho', 'alto'])('%s — valor límite mínimo 1', (campo) => {
    it('acepta 1', async () => {
      expect(
        await validar(MesaLayoutDto, { ...LAYOUT_VALIDO, [campo]: 1 }),
      ).toHaveLength(0);
    });

    it.each([0, -10])('rechaza %p', async (valor) => {
      const errores = await validar(MesaLayoutDto, {
        ...LAYOUT_VALIDO,
        [campo]: valor,
      });
      expect(propiedadesConError(errores)).toEqual([campo]);
    });
  });

  // BL-58: topes para que no se persistan valores absurdos en el JSON.
  describe.each(['ancho', 'alto'])(
    '%s — valor límite máximo (DIMENSION_MAXIMA_MESA)',
    (campo) => {
      it('acepta el máximo', async () => {
        expect(
          await validar(MesaLayoutDto, {
            ...LAYOUT_VALIDO,
            [campo]: DIMENSION_MAXIMA_MESA,
          }),
        ).toHaveLength(0);
      });

      it('rechaza el máximo + 1', async () => {
        const errores = await validar(MesaLayoutDto, {
          ...LAYOUT_VALIDO,
          [campo]: DIMENSION_MAXIMA_MESA + 1,
        });
        expect(propiedadesConError(errores)).toEqual([campo]);
      });
    },
  );

  describe.each(['x', 'y'])(
    '%s — valores límite [-COORDENADA_MAXIMA_MESA, COORDENADA_MAXIMA_MESA]',
    (campo) => {
      // Negativos válidos: el editor no limitaba el arrastre, así que hay
      // layouts guardados con mesas apenas fuera del borde del canvas.
      it.each([-COORDENADA_MAXIMA_MESA, -15, COORDENADA_MAXIMA_MESA])(
        'acepta %p',
        async (valor) => {
          expect(
            await validar(MesaLayoutDto, { ...LAYOUT_VALIDO, [campo]: valor }),
          ).toHaveLength(0);
        },
      );

      it.each([-COORDENADA_MAXIMA_MESA - 1, COORDENADA_MAXIMA_MESA + 1])(
        'rechaza %p',
        async (valor) => {
          const errores = await validar(MesaLayoutDto, {
            ...LAYOUT_VALIDO,
            [campo]: valor,
          });
          expect(propiedadesConError(errores)).toEqual([campo]);
        },
      );
    },
  );

  it.each(['x', 'y', 'ancho', 'alto', 'rotacion'])(
    'rechaza %s como string numérico (no hay coerción implícita)',
    async (campo) => {
      const errores = await validar(MesaLayoutDto, {
        ...LAYOUT_VALIDO,
        [campo]: '10',
      });
      expect(propiedadesConError(errores)).toContain(campo);
    },
  );

  it.each([NaN, Infinity])('rechaza x = %p', async (x) => {
    const errores = await validar(MesaLayoutDto, { ...LAYOUT_VALIDO, x });
    expect(propiedadesConError(errores)).toEqual(['x']);
  });

  it.each(['x', 'y', 'forma', 'ancho', 'alto', 'rotacion'])(
    'rechaza el layout si falta %s',
    async (campo) => {
      const incompleto: Record<string, unknown> = { ...LAYOUT_VALIDO };
      delete incompleto[campo];
      const errores = await validar(MesaLayoutDto, incompleto);
      expect(propiedadesConError(errores)).toContain(campo);
    },
  );

  // [S] del DoD: el JSON del layout no puede transportar contenido arbitrario.
  it('rechaza propiedades que no forman parte del layout (ej. un handler JS embebido)', async () => {
    const errores = await validar(MesaLayoutDto, {
      ...LAYOUT_VALIDO,
      onClick: 'alert(document.cookie)',
    });
    expect(propiedadesConError(errores)).toEqual(['onClick']);
  });
});

describe('MesaLayoutItemDto (HU-016)', () => {
  it('acepta un item sin id (mesa nueva)', async () => {
    expect(
      await validar(MesaLayoutItemDto, { numero: 1, ...LAYOUT_VALIDO }),
    ).toHaveLength(0);
  });

  it('acepta un item con id UUID (mesa existente)', async () => {
    expect(
      await validar(MesaLayoutItemDto, {
        id: MESA_ID,
        numero: 1,
        ...LAYOUT_VALIDO,
      }),
    ).toHaveLength(0);
  });

  it('rechaza un id que no es UUID', async () => {
    const errores = await validar(MesaLayoutItemDto, {
      id: 'mesa-1',
      numero: 1,
      ...LAYOUT_VALIDO,
    });
    expect(propiedadesConError(errores)).toEqual(['id']);
  });

  describe('numero — valor límite mínimo 1 (0 reservado a la mesa virtual)', () => {
    it('acepta 1', async () => {
      expect(
        await validar(MesaLayoutItemDto, { numero: 1, ...LAYOUT_VALIDO }),
      ).toHaveLength(0);
    });

    it('rechaza 0 con el mensaje de la mesa virtual', async () => {
      const errores = await validar(MesaLayoutItemDto, {
        numero: 0,
        ...LAYOUT_VALIDO,
      });
      expect(propiedadesConError(errores)).toEqual(['numero']);
      expect(Object.values(errores[0].constraints ?? {})).toContain(
        'numero debe ser mayor a 0 (el 0 está reservado a la mesa virtual de HU-003)',
      );
    });

    it('rechaza un número no entero', async () => {
      const errores = await validar(MesaLayoutItemDto, {
        numero: 1.5,
        ...LAYOUT_VALIDO,
      });
      expect(propiedadesConError(errores)).toEqual(['numero']);
    });
  });
});

describe('GuardarLayoutDto (HU-016)', () => {
  it('acepta un guardado con al menos una mesa', async () => {
    expect(
      await validar(GuardarLayoutDto, {
        restauranteId: RESTAURANTE_ID,
        mesas: [{ numero: 1, ...LAYOUT_VALIDO }],
      }),
    ).toHaveLength(0);
  });

  it('rechaza un guardado sin mesas (array vacío)', async () => {
    const errores = await validar(GuardarLayoutDto, {
      restauranteId: RESTAURANTE_ID,
      mesas: [],
    });
    expect(propiedadesConError(errores)).toEqual(['mesas']);
  });

  describe('mesas — valor límite máximo 200 por guardado (BL-58)', () => {
    const mesas = (cantidad: number) =>
      Array.from({ length: cantidad }, (_, i) => ({
        numero: i + 1,
        ...LAYOUT_VALIDO,
      }));

    it('acepta 200 mesas', async () => {
      expect(
        await validar(GuardarLayoutDto, {
          restauranteId: RESTAURANTE_ID,
          mesas: mesas(200),
        }),
      ).toHaveLength(0);
    });

    it('rechaza 201 mesas con el mensaje del tope', async () => {
      const errores = await validar(GuardarLayoutDto, {
        restauranteId: RESTAURANTE_ID,
        mesas: mesas(201),
      });
      expect(propiedadesConError(errores)).toEqual(['mesas']);
      expect(Object.values(errores[0].constraints ?? {})).toContain(
        'no se pueden guardar más de 200 mesas por vez',
      );
    });
  });

  it('acepta restauranteId e id de mesa del seed Demo (formato UUID no RFC 4122)', async () => {
    expect(
      await validar(GuardarLayoutDto, {
        restauranteId: '22222222-2222-2222-2222-222222222222',
        mesas: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            numero: 1,
            ...LAYOUT_VALIDO,
          },
        ],
      }),
    ).toHaveLength(0);
  });

  it('rechaza un restauranteId que no es UUID', async () => {
    const errores = await validar(GuardarLayoutDto, {
      restauranteId: 'restaurante-1',
      mesas: [{ numero: 1, ...LAYOUT_VALIDO }],
    });
    expect(propiedadesConError(errores)).toEqual(['restauranteId']);
  });

  it('valida cada mesa anidada: un layout inválido en la 2da mesa invalida el guardado completo', async () => {
    const errores = await validar(GuardarLayoutDto, {
      restauranteId: RESTAURANTE_ID,
      mesas: [
        { numero: 1, ...LAYOUT_VALIDO },
        { numero: 2, ...LAYOUT_VALIDO, rotacion: 360 },
      ],
    });
    expect(propiedadesConError(errores)).toEqual(['mesas']);
    const errorMesa2 = errores[0].children?.find((c) => c.property === '1');
    expect(errorMesa2?.children?.map((c) => c.property)).toEqual(['rotacion']);
  });

  it('rechaza propiedades extra dentro de una mesa anidada', async () => {
    const errores = await validar(GuardarLayoutDto, {
      restauranteId: RESTAURANTE_ID,
      mesas: [{ numero: 1, ...LAYOUT_VALIDO, script: '<script>x</script>' }],
    });
    const errorMesa1 = errores[0].children?.find((c) => c.property === '0');
    expect(errorMesa1?.children?.map((c) => c.property)).toEqual(['script']);
  });
});

describe('ListarLayoutQueryDto (HU-016)', () => {
  it('acepta un restauranteId UUID', async () => {
    expect(
      await validar(ListarLayoutQueryDto, { restauranteId: RESTAURANTE_ID }),
    ).toHaveLength(0);
  });

  it('acepta un id con formato UUID aunque no sea RFC 4122 (ids del seed Demo)', async () => {
    expect(
      await validar(ListarLayoutQueryDto, {
        restauranteId: '22222222-2222-2222-2222-222222222222',
      }),
    ).toHaveLength(0);
  });

  it('rechaza un restauranteId ausente o inválido', async () => {
    expect(
      propiedadesConError(await validar(ListarLayoutQueryDto, {})),
    ).toEqual(['restauranteId']);
    expect(
      propiedadesConError(
        await validar(ListarLayoutQueryDto, { restauranteId: 'abc' }),
      ),
    ).toEqual(['restauranteId']);
  });
});
