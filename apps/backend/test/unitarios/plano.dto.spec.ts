import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  DIMENSION_MAXIMA_ZONA,
  LARGO_MAXIMO_ETIQUETA_ZONA,
  MAXIMO_ELEMENTOS_PLANO,
  MAXIMO_ZONAS_PLANO,
  PlanoDto,
  TIPOS_ELEMENTO_PLANO,
} from '../../src/mesas/dto/plano.dto';
import { GuardarLayoutDto } from '../../src/mesas/dto/guardar-layout.dto';

/**
 * HU-028 (BL-173): validación del plano del salón (elementos fijos y zonas)
 * en el borde de la API. Mismas opciones que el ValidationPipe de main.ts.
 */

const OPCIONES_PIPE = { whitelist: true, forbidNonWhitelisted: true };
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';

const ELEMENTO = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  tipo: 'PUERTA',
  x: 40,
  y: 300,
  ancho: 60,
  alto: 20,
  rotacion: 90,
};

const ZONA = {
  id: 'bbbbbbbb-2222-4222-8222-222222222222',
  etiqueta: 'Patio',
  x: 400,
  y: 300,
  ancho: 600,
  alto: 400,
};

async function validarPlano(plano: Record<string, unknown>) {
  return validate(plainToInstance(PlanoDto, plano), OPCIONES_PIPE);
}

/** Recorre los errores anidados y junta las propiedades que fallaron. */
function propiedades(errores: ValidationError[]): string[] {
  return errores.flatMap((e) => [e.property, ...propiedades(e.children ?? [])]);
}

describe('PlanoDto (HU-028)', () => {
  it('acepta un plano con elementos y zonas', async () => {
    expect(
      await validarPlano({ elementos: [ELEMENTO], zonas: [ZONA] }),
    ).toHaveLength(0);
  });

  it('acepta un plano vacío', async () => {
    expect(await validarPlano({ elementos: [], zonas: [] })).toHaveLength(0);
  });

  it.each(TIPOS_ELEMENTO_PLANO)('acepta el tipo %s', async (tipo) => {
    expect(
      await validarPlano({ elementos: [{ ...ELEMENTO, tipo }], zonas: [] }),
    ).toHaveLength(0);
  });

  it('rechaza un tipo que no existe', async () => {
    const errores = await validarPlano({
      elementos: [{ ...ELEMENTO, tipo: 'ASCENSOR' }],
      zonas: [],
    });
    expect(propiedades(errores)).toContain('tipo');
  });

  it('rechaza un elemento con número o estado: no son mesas', async () => {
    const errores = await validarPlano({
      elementos: [{ ...ELEMENTO, numero: 3, estado: 'LIBRE' }],
      zonas: [],
    });
    expect(propiedades(errores)).toEqual(
      expect.arrayContaining(['numero', 'estado']),
    );
  });

  it('rechaza una zona con propiedades extra', async () => {
    const errores = await validarPlano({
      elementos: [],
      zonas: [{ ...ZONA, mesas: ['x'] }],
    });
    expect(propiedades(errores)).toContain('mesas');
  });

  it('rechaza un id que no es UUID', async () => {
    const errores = await validarPlano({
      elementos: [{ ...ELEMENTO, id: 'puerta-1' }],
      zonas: [],
    });
    expect(propiedades(errores)).toContain('id');
  });

  it.each(['Salón', 'Patio 2', 'Calle (vereda)', "D'Angelo", 'Terraza-norte'])(
    'acepta la etiqueta "%s"',
    async (etiqueta) => {
      expect(
        await validarPlano({ elementos: [], zonas: [{ ...ZONA, etiqueta }] }),
      ).toHaveLength(0);
    },
  );

  it.each([
    ['vacía', ''],
    ['con HTML', '<b>Patio</b>'],
    ['con script', '<script>alert(1)</script>'],
    ['demasiado larga', 'a'.repeat(LARGO_MAXIMO_ETIQUETA_ZONA + 1)],
  ])('rechaza una etiqueta %s', async (_caso, etiqueta) => {
    const errores = await validarPlano({
      elementos: [],
      zonas: [{ ...ZONA, etiqueta }],
    });
    expect(propiedades(errores)).toContain('etiqueta');
  });

  it('acepta una zona del tamaño máximo y rechaza una más grande', async () => {
    const enElLimite = await validarPlano({
      elementos: [],
      zonas: [{ ...ZONA, ancho: DIMENSION_MAXIMA_ZONA }],
    });
    const pasada = await validarPlano({
      elementos: [],
      zonas: [{ ...ZONA, ancho: DIMENSION_MAXIMA_ZONA + 1 }],
    });

    expect(enElLimite).toHaveLength(0);
    expect(propiedades(pasada)).toContain('ancho');
  });

  it('rechaza una rotación fuera de 0-359', async () => {
    const errores = await validarPlano({
      elementos: [{ ...ELEMENTO, rotacion: 360 }],
      zonas: [],
    });
    expect(propiedades(errores)).toContain('rotacion');
  });

  it('rechaza más elementos y zonas que el máximo', async () => {
    const elementos = Array.from(
      { length: MAXIMO_ELEMENTOS_PLANO + 1 },
      () => ELEMENTO,
    );
    const zonas = Array.from({ length: MAXIMO_ZONAS_PLANO + 1 }, () => ZONA);

    expect(propiedades(await validarPlano({ elementos, zonas }))).toEqual(
      expect.arrayContaining(['elementos', 'zonas']),
    );
  });

  it('exige las dos listas, aunque estén vacías', async () => {
    expect(propiedades(await validarPlano({}))).toEqual(
      expect.arrayContaining(['elementos', 'zonas']),
    );
  });
});

describe('GuardarLayoutDto con plano (HU-028)', () => {
  async function validarGuardado(body: Record<string, unknown>) {
    return validate(plainToInstance(GuardarLayoutDto, body), OPCIONES_PIPE);
  }

  it('acepta un guardado que solo trae el plano, sin mesas', async () => {
    expect(
      await validarGuardado({
        restauranteId: RESTAURANTE_ID,
        mesas: [],
        plano: { elementos: [ELEMENTO], zonas: [ZONA] },
      }),
    ).toHaveLength(0);
  });

  it('sigue rechazando un guardado sin mesas, sin eliminaciones y sin plano', async () => {
    const errores = await validarGuardado({
      restauranteId: RESTAURANTE_ID,
      mesas: [],
    });
    expect(propiedades(errores)).toContain('mesas');
  });

  it('valida el plano anidado', async () => {
    const errores = await validarGuardado({
      restauranteId: RESTAURANTE_ID,
      mesas: [],
      plano: { elementos: [{ ...ELEMENTO, tipo: 'ASCENSOR' }], zonas: [] },
    });
    expect(propiedades(errores)).toEqual(
      expect.arrayContaining(['plano', 'tipo']),
    );
  });
});
