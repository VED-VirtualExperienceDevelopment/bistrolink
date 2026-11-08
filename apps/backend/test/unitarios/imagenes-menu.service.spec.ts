import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ImagenesMenuService } from '../../src/menu/imagenes-menu.service';
import { StorageService } from '../../src/menu/storage.service';
import { ProcesadorImagenService } from '../../src/menu/procesador-imagen.service';

// BL-391 (BL-386): orden de los pasos de la confirmación. La regla de la key
// se prueba en storage.service.spec y el procesador en su propio spec.

const TENANT = '11111111-1111-4111-8111-111111111111';
const UUID = '0b4f6a3e-1111-4c2d-9e8f-123456789abc';
const KEY_CUARENTENA = `incoming/${TENANT}/${UUID}`;

describe('ImagenesMenuService.confirmar (BL-386)', () => {
  const storage = {
    uuidDeKeyDeCuarentena: jest.fn(),
    leerDeCuarentena: jest.fn(),
    guardarImagenPublicada: jest.fn(),
    urlFirmadaDeLectura: jest.fn(),
  };
  const procesador = { procesar: jest.fn() };
  const servicio = new ImagenesMenuService(
    storage as unknown as StorageService,
    procesador as unknown as ProcesadorImagenService,
  );

  const ORIGINAL = Buffer.from('original');
  const PROCESADA = Buffer.from('procesada');

  beforeEach(() => {
    jest.resetAllMocks();
    storage.uuidDeKeyDeCuarentena.mockReturnValue(UUID);
    storage.leerDeCuarentena.mockResolvedValue(ORIGINAL);
    procesador.procesar.mockResolvedValue(PROCESADA);
    storage.guardarImagenPublicada.mockResolvedValue(undefined);
    storage.urlFirmadaDeLectura.mockResolvedValue('https://firmada.example');
  });

  it('publica la imagen procesada en {tenant}/menu/{uuid}.webp y devuelve key y URL', async () => {
    const resultado = await servicio.confirmar(KEY_CUARENTENA, TENANT);

    expect(storage.uuidDeKeyDeCuarentena).toHaveBeenCalledWith(
      KEY_CUARENTENA,
      TENANT,
    );
    expect(procesador.procesar).toHaveBeenCalledWith(ORIGINAL);
    expect(storage.guardarImagenPublicada).toHaveBeenCalledWith(
      `${TENANT}/menu/${UUID}.webp`,
      PROCESADA,
    );
    expect(resultado).toEqual({
      key: `${TENANT}/menu/${UUID}.webp`,
      url: 'https://firmada.example',
    });
  });

  it('una key inválida o de otro tenant: 400 sin leer nada del bucket', async () => {
    storage.uuidDeKeyDeCuarentena.mockReturnValue(null);

    await expect(
      servicio.confirmar(`incoming/otro-tenant/${UUID}`, TENANT),
    ).rejects.toThrow(
      new BadRequestException(
        'La imagen no es válida para este establecimiento',
      ),
    );
    expect(storage.leerDeCuarentena).not.toHaveBeenCalled();
    expect(storage.guardarImagenPublicada).not.toHaveBeenCalled();
  });

  it('si el procesador rechaza el archivo, no publica nada', async () => {
    procesador.procesar.mockRejectedValue(
      new BadRequestException('El archivo no es una imagen válida'),
    );

    await expect(servicio.confirmar(KEY_CUARENTENA, TENANT)).rejects.toThrow(
      'El archivo no es una imagen válida',
    );
    expect(storage.guardarImagenPublicada).not.toHaveBeenCalled();
  });

  it('si el archivo no está en la cuarentena (no se subió o venció), propaga el 404', async () => {
    storage.leerDeCuarentena.mockRejectedValue(new NotFoundException());

    await expect(servicio.confirmar(KEY_CUARENTENA, TENANT)).rejects.toThrow(
      NotFoundException,
    );
    expect(procesador.procesar).not.toHaveBeenCalled();
  });

  it('confirmar dos veces la misma subida da la misma key (idempotente)', async () => {
    const primera = await servicio.confirmar(KEY_CUARENTENA, TENANT);
    const segunda = await servicio.confirmar(KEY_CUARENTENA, TENANT);

    expect(segunda.key).toBe(primera.key);
  });
});
