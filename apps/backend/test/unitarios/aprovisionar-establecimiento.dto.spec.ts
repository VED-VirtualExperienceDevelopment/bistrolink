import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { AprovisionarEstablecimientoDto } from '../../src/plataforma/dto/aprovisionar-establecimiento.dto';

/**
 * BL-163 (HU-027): validación de los datos del alta de establecimiento.
 * Mismas opciones que el ValidationPipe global de main.ts y que el script.
 */

const OPCIONES = { whitelist: true, forbidNonWhitelisted: true };

const VALIDO = {
  razonSocial: 'Restaurante de Prueba SRL',
  rut: '219999999901',
  restaurante: { nombre: 'Restaurante de Prueba', direccion: 'Calle 123' },
  admin: {
    username: 'prueba-admin',
    email: 'prueba-admin@prueba.bistrolink.local',
    nombre: 'Admin',
    apellido: 'De Prueba',
  },
  cocina: { username: 'prueba-cocina' },
};

async function validar(plano: Record<string, unknown>) {
  return validate(
    plainToInstance(AprovisionarEstablecimientoDto, plano),
    OPCIONES,
  );
}

function rutas(errores: ValidationError[], prefijo = ''): string[] {
  return errores.flatMap((e) => {
    const ruta = prefijo ? `${prefijo}.${e.property}` : e.property;
    return e.children?.length ? rutas(e.children, ruta) : [ruta];
  });
}

describe('AprovisionarEstablecimientoDto (BL-163)', () => {
  it('acepta un alta mínima válida (sin ids, sin plan ni timezone)', async () => {
    expect(await validar(VALIDO)).toHaveLength(0);
  });

  it('acepta tenantId y restaurante.id con formato UUID del seed (no RFC 4122)', async () => {
    expect(
      await validar({
        ...VALIDO,
        tenantId: '11111111-1111-1111-1111-111111111111',
        restaurante: {
          ...VALIDO.restaurante,
          id: '22222222-2222-2222-2222-222222222222',
        },
      }),
    ).toHaveLength(0);
  });

  it.each(['21999999990', '2199999999011', '21999999990A'])(
    'rechaza el RUT %p (tienen que ser 12 dígitos)',
    async (rut) => {
      expect(rutas(await validar({ ...VALIDO, rut }))).toEqual(['rut']);
    },
  );

  it.each(['Prueba-Admin', 'ab', 'admin con espacio', '-admin'])(
    'rechaza el username %p',
    async (username) => {
      expect(
        rutas(
          await validar({ ...VALIDO, admin: { ...VALIDO.admin, username } }),
        ),
      ).toEqual(['admin.username']);
    },
  );

  it('rechaza un email inválido', async () => {
    expect(
      rutas(
        await validar({
          ...VALIDO,
          cocina: { username: 'prueba-cocina', email: 'no-es-email' },
        }),
      ),
    ).toEqual(['cocina.email']);
  });

  it('rechaza propiedades que no forman parte del alta (por ejemplo, una contraseña)', async () => {
    expect(
      rutas(
        await validar({
          ...VALIDO,
          admin: { ...VALIDO.admin, password: 'no-va-acá' },
        }),
      ),
    ).toEqual(['admin.password']);
  });

  it.each(['email', 'nombre', 'apellido'])(
    'rechaza el alta si al Administrador le falta %s (el realm lo exige)',
    async (campo) => {
      const admin: Record<string, unknown> = { ...VALIDO.admin };
      delete admin[campo];
      expect(rutas(await validar({ ...VALIDO, admin }))).toEqual([
        `admin.${campo}`,
      ]);
    },
  );

  it.each(['razonSocial', 'rut', 'restaurante', 'admin', 'cocina'])(
    'rechaza el alta si falta %s',
    async (campo) => {
      const incompleto: Record<string, unknown> = { ...VALIDO };
      delete incompleto[campo];
      expect(rutas(await validar(incompleto))).toContain(campo);
    },
  );
});
