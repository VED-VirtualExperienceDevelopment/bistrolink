import { BadRequestException, Injectable } from '@nestjs/common';
import type { Metadata } from 'sharp';
import type SharpConstructor from 'sharp';

// sharp 0.35 publica tipos ESM ("export default") y el backend compila a
// CommonJS sin esModuleInterop: con "import sharp from 'sharp'" la función
// quedaría undefined al ejecutar. Se carga con require y se tipa a mano.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp: typeof SharpConstructor = require('sharp');

import {
  CALIDAD_WEBP,
  FORMATOS_REALES_PERMITIDOS,
  LADO_MAXIMO_IMAGEN_PX,
  MAXIMO_PIXELES_ENTRADA,
} from './upload.constants';

// La API no guarda imágenes en memoria entre pedidos: sin caché de libvips.
sharp.cache(false);

const MENSAJE_NO_ES_IMAGEN = 'El archivo no es una imagen válida';

/**
 * BL-385 / BL-386: verifica y regenera la imagen que subió el navegador.
 *
 * No confía en nada de lo declarado (nombre, extensión, Content-Type):
 * - el formato lo determina el CONTENIDO del archivo;
 * - la imagen se decodifica entera; si está rota o no es una imagen, 400;
 * - se rechazan las de más de 25 megapíxeles y las animadas;
 * - se genera una imagen NUEVA en WebP, orientada y de hasta 1600 px.
 *
 * sharp no copia los metadatos al archivo nuevo (EXIF, GPS, modelo del
 * teléfono, perfiles): se van solos. Tampoco viaja nada que estuviera
 * pegado al archivo original (archivos "políglotas"), porque el resultado
 * se arma solo con los píxeles.
 */
@Injectable()
export class ProcesadorImagenService {
  async procesar(original: Buffer): Promise<Buffer> {
    let metadatos: Metadata;
    try {
      metadatos = await sharp(original).metadata();
    } catch {
      throw new BadRequestException(MENSAJE_NO_ES_IMAGEN);
    }

    const formato = metadatos.format as string | undefined;
    if (
      !formato ||
      !(FORMATOS_REALES_PERMITIDOS as readonly string[]).includes(formato)
    ) {
      throw new BadRequestException(
        `${MENSAJE_NO_ES_IMAGEN}. Solo se aceptan imágenes JPEG, PNG o WEBP.`,
      );
    }

    // sharp siempre informa las dimensiones de JPEG, PNG y WEBP. Si faltaran,
    // el cálculo da 0 y la decodificación de abajo (con limitInputPixels)
    // hace de control.
    const pixeles = (metadatos.width ?? 0) * (metadatos.height ?? 0);
    if (pixeles > MAXIMO_PIXELES_ENTRADA) {
      throw new BadRequestException(
        'La imagen es demasiado grande (máximo 25 megapíxeles)',
      );
    }

    if ((metadatos.pages ?? 1) > 1) {
      throw new BadRequestException('No se aceptan imágenes animadas');
    }

    try {
      return await sharp(original, {
        // Segunda barrera por si los metadatos mienten las dimensiones.
        limitInputPixels: MAXIMO_PIXELES_ENTRADA,
        // Rechaza archivos con errores de decodificación (truncados o
        // manipulados). Las advertencias menores se toleran: son comunes en
        // fotos de celular y no son un riesgo.
        failOn: 'error',
      })
        .rotate() // orienta según el EXIF antes de descartarlo
        .resize({
          width: LADO_MAXIMO_IMAGEN_PX,
          height: LADO_MAXIMO_IMAGEN_PX,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: CALIDAD_WEBP })
        .toBuffer();
    } catch {
      throw new BadRequestException(MENSAJE_NO_ES_IMAGEN);
    }
  }
}
