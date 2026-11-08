import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUsuarioDto } from '../../src/usuarios/dto/update-usuario.dto';

/** BL-366: PATCH /usuarios/:id con rol, nombre, apellido y correo opcionales. */

const errores = async (plano: object) =>
  (await validate(plainToInstance(UpdateUsuarioDto, plano))).map(
    (e) => e.property,
  );

describe('UpdateUsuarioDto (BL-366)', () => {
  it('[TC-U-073] acepta cualquier combinación de campos, incluido solo el rol', async () => {
    expect(await errores({ rol: 'ADMIN' })).toEqual([]);
    expect(await errores({ nombre: 'Juan Carlos' })).toEqual([]);
    expect(
      await errores({
        nombre: 'María José',
        apellido: 'Pérez-Núñez',
        email: 'mj@ejemplo.com',
        rol: 'MOZO',
      }),
    ).toEqual([]);
  });

  it('[TC-U-074] rechaza un correo inválido o vacío (se puede cambiar, no borrar)', async () => {
    expect(await errores({ email: 'no-es-un-correo' })).toEqual(['email']);
    expect(await errores({ email: '   ' })).toEqual(['email']);
  });

  it('[TC-U-075] aplica al nombre y al apellido las mismas reglas que el alta', async () => {
    expect(await errores({ nombre: 'Juan & Ana' })).toEqual(['nombre']);
    expect(await errores({ apellido: '' })).toEqual(['apellido']);
    expect(await errores({ apellido: 'a'.repeat(61) })).toEqual(['apellido']);
  });

  it('[TC-U-076] rechaza un rol que no se puede asignar (COCINA)', async () => {
    expect(await errores({ rol: 'COCINA' })).toEqual(['rol']);
  });

  it('[TC-U-077] limpia los espacios del nombre y del correo', async () => {
    const dto = plainToInstance(UpdateUsuarioDto, {
      nombre: '  Juan   Carlos ',
      email: ' jc@ejemplo.com ',
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.nombre).toBe('Juan Carlos');
    expect(dto.email).toBe('jc@ejemplo.com');
  });
});
