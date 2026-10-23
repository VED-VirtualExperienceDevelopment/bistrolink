import { BadRequestException } from '@nestjs/common';
import type SharpConstructor from 'sharp';
import { ProcesadorImagenService } from '../../src/menu/procesador-imagen.service';

// Mismo patrón que el servicio: sharp publica tipos ESM y el backend compila
// a CommonJS sin esModuleInterop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp: typeof SharpConstructor = require('sharp');

// BL-391 (BL-385, BL-386): el procesador no confía en nada de lo declarado.
// Se prueba con imágenes reales generadas en memoria, sin mocks de sharp.

const MENSAJE_NO_ES_IMAGEN = 'El archivo no es una imagen válida';

function imagen(
  ancho: number,
  alto: number,
  formato: 'jpeg' | 'png' | 'webp' | 'gif' = 'png',
): Promise<Buffer> {
  return sharp({
    create: {
      width: ancho,
      height: alto,
      channels: 3,
      background: '#c0392b',
    },
  })
    .toFormat(formato)
    .toBuffer();
}

// CRC32 de PNG (sin depender de zlib.crc32, que no está en Node 20).
function crc32(datos: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of datos) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * "Bomba de píxeles": un PNG de pocos bytes cuya cabecera declara
 * dimensiones enormes. Se parte de un PNG real de 1×1 y se reescriben el
 * ancho y el alto del chunk IHDR (con su CRC).
 */
async function pngQueDeclara(ancho: number, alto: number): Promise<Buffer> {
  const png = Buffer.from(await imagen(1, 1, 'png'));
  // Firma (8) + largo (4) + "IHDR" (4) → el ancho empieza en el byte 16.
  png.writeUInt32BE(ancho, 16);
  png.writeUInt32BE(alto, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return png;
}

describe('ProcesadorImagenService (BL-386)', () => {
  const procesador = new ProcesadorImagenService();

  describe('rechaza lo que no es una imagen permitida', () => {
    it('un archivo de texto declarado como imagen: 400', async () => {
      await expect(
        procesador.procesar(Buffer.from('<html><script>alert(1)</script>')),
      ).rejects.toThrow(new BadRequestException(MENSAJE_NO_ES_IMAGEN));
    });

    it('un SVG (puede llevar scripts): 400 aunque sea una imagen', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
      );

      await expect(procesador.procesar(svg)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('un GIF (formato no permitido): 400', async () => {
      await expect(
        procesador.procesar(await imagen(10, 10, 'gif')),
      ).rejects.toThrow(BadRequestException);
    });

    it('un JPEG truncado: 400', async () => {
      const jpeg = await imagen(400, 300, 'jpeg');

      await expect(
        procesador.procesar(jpeg.subarray(0, Math.floor(jpeg.length / 2))),
      ).rejects.toThrow(new BadRequestException(MENSAJE_NO_ES_IMAGEN));
    });

    it('una bomba de píxeles (PNG chico que declara 10.000 × 10.000): 400 sin decodificarla', async () => {
      const bomba = await pngQueDeclara(10_000, 10_000);
      expect(bomba.length).toBeLessThan(1024);

      await expect(procesador.procesar(bomba)).rejects.toThrow(
        'La imagen es demasiado grande (máximo 25 megapíxeles)',
      );
    });

    it('una imagen animada: 400', async () => {
      // Cuadros de colores distintos: si son iguales, el codificador WebP los
      // junta en uno solo y la imagen deja de ser animada.
      const cuadro = (color: string) =>
        sharp({
          create: { width: 20, height: 20, channels: 3, background: color },
        })
          .png()
          .toBuffer();
      const cuadros = await Promise.all([cuadro('#ff0000'), cuadro('#0000ff')]);
      const animada = await sharp(cuadros, { join: { animated: true } })
        .webp()
        .toBuffer();

      await expect(procesador.procesar(animada)).rejects.toThrow(
        'No se aceptan imágenes animadas',
      );
    });
  });

  describe('genera una imagen nueva y limpia', () => {
    it.each(['jpeg', 'png', 'webp'] as const)(
      'acepta %s y devuelve WebP',
      async (formato) => {
        const salida = await procesador.procesar(
          await imagen(300, 200, formato),
        );

        expect((await sharp(salida).metadata()).format).toBe('webp');
      },
    );

    it('quita los metadatos EXIF (incluida la ubicación GPS)', async () => {
      const conGps = await sharp({
        create: { width: 100, height: 80, channels: 3, background: '#888' },
      })
        .jpeg()
        .withExif({
          IFD0: { Make: 'Telefono', Model: 'Modelo X' },
          // IFD3 es el bloque GPS del EXIF.
          IFD3: { GPSLatitudeRef: 'S', GPSLongitudeRef: 'W' },
        })
        .toBuffer();
      expect((await sharp(conGps).metadata()).exif).toBeDefined();

      const salida = await procesador.procesar(conGps);

      const metadatos = await sharp(salida).metadata();
      expect(metadatos.exif).toBeUndefined();
      expect(salida.includes(Buffer.from('Telefono'))).toBe(false);
    });

    it('descarta lo que venga pegado al archivo (políglota)', async () => {
      const poliglota = Buffer.concat([
        await imagen(50, 50, 'png'),
        Buffer.from('<script>alert(1)</script>'),
      ]);

      const salida = await procesador.procesar(poliglota);

      expect((await sharp(salida).metadata()).format).toBe('webp');
      expect(salida.includes(Buffer.from('<script>'))).toBe(false);
    });

    it('achica a 1600 px de lado como máximo, sin deformar', async () => {
      const salida = await procesador.procesar(await imagen(3000, 2000));

      const { width, height } = await sharp(salida).metadata();
      expect(width).toBe(1600);
      expect(height).toBe(1067);
    });

    it('no agranda las imágenes chicas', async () => {
      const salida = await procesador.procesar(await imagen(800, 600));

      const { width, height } = await sharp(salida).metadata();
      expect([width, height]).toEqual([800, 600]);
    });

    it('orienta la imagen según el EXIF antes de descartarlo', async () => {
      // 200 × 100 con orientación 6 (rotada 90°): se ve vertical.
      const rotada = await sharp({
        create: { width: 200, height: 100, channels: 3, background: '#888' },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      const salida = await procesador.procesar(rotada);

      const { width, height } = await sharp(salida).metadata();
      expect([width, height]).toEqual([100, 200]);
    });
  });
});
