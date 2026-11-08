import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PresignedUrlDto } from '../../src/menu/dto/presigned-url.dto';

describe('PresignedUrlDto (BL-54: solo imágenes jpeg/png/webp)', () => {
  const base = { contentType: 'image/jpeg', fileSize: 1024 };

  // Mismas opciones que el ValidationPipe global de main.ts.
  const propiedadesConError = async (datos: Record<string, unknown>) => {
    const errores = await validate(plainToInstance(PresignedUrlDto, datos), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errores.map((e) => e.property);
  };

  it('un pedido bien formado es válido', async () => {
    expect(await propiedadesConError(base)).toEqual([]);
  });

  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'acepta el tipo %s',
    async (contentType) => {
      expect(await propiedadesConError({ ...base, contentType })).toEqual([]);
    },
  );

  it.each([
    'image/gif',
    'image/svg+xml',
    'text/html',
    'application/pdf',
    'IMAGE/JPEG',
    '',
  ])('rechaza el tipo %p', async (contentType) => {
    expect(await propiedadesConError({ ...base, contentType })).toEqual([
      'contentType',
    ]);
  });

  it('rechaza un pedido sin contentType', async () => {
    expect(await propiedadesConError({ fileSize: 1024 })).toEqual([
      'contentType',
    ]);
  });

  it.each([0, -1, 1.5, '1024', null])(
    'rechaza fileSize %p',
    async (fileSize) => {
      expect(await propiedadesConError({ ...base, fileSize })).toEqual([
        'fileSize',
      ]);
    },
  );

  // El tope de 5 MB no está en el DTO a propósito: si estuviera, respondería
  // 400. Lo controla StorageService para responder 413.
  it('deja pasar un fileSize mayor a 5 MB (el 413 lo da el servicio)', async () => {
    expect(
      await propiedadesConError({ ...base, fileSize: 50 * 1024 * 1024 }),
    ).toEqual([]);
  });

  // fileName ya no forma parte del contrato: la key la arma el backend.
  it('rechaza propiedades extra como fileName', async () => {
    expect(
      await propiedadesConError({ ...base, fileName: '../../otro/x.jpg' }),
    ).toEqual(['fileName']);
  });
});
