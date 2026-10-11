import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { v4 as uuidv4 } from 'uuid';
import {
  EXTENSION_POR_TIPO,
  TAMANIO_MAXIMO_IMAGEN_BYTES,
  TipoImagenPermitido,
  TTL_URL_LECTURA_SEGUNDOS,
  TTL_URL_SUBIDA_SEGUNDOS,
} from './upload.constants';

@Injectable()
export class StorageService {
  // Lazy: se instancia recién en el primer uso real, no al bootear Nest.
  // Así, si alguien todavía no configuró las variables de AWS, la app sigue
  // levantando igual — solo falla si de verdad se pide un ítem con imagen.
  private s3Client: S3Client | null = null;

  private getClient(): S3Client {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        region: process.env.AWS_REGION || 'auto',
        endpoint: process.env.AWS_S3_ENDPOINT,
        forcePathStyle: !!process.env.AWS_S3_ENDPOINT,
      });
    }
    return this.s3Client;
  }

  /**
   * URL firmada de LECTURA con TTL (HU-001: las imágenes se sirven vía URLs
   * firmadas con TTL, no URLs públicas permanentes).
   */
  async getSignedImageUrl(key: string): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_IMAGES,
        Key: key,
      });
      return await getSignedUrl(this.getClient(), command, {
        expiresIn: TTL_URL_LECTURA_SEGUNDOS,
      });
    } catch (error) {
      // No dejamos que un problema de S3 (bucket mal configurado, credenciales
      // vencidas, etc.) tire abajo el menú entero — el comensal sigue viendo
      // nombre/descripción/precio, solo sin imagen para ese ítem puntual.
      console.error(`No se pudo generar la URL firmada para "${key}":`, error);
      return null;
    }
  }

  /**
   * URL firmada de SUBIDA directa desde el frontend (BL-54).
   *
   * - El tipo ya llega validado por el DTO (solo jpeg/png/webp).
   * - Si el tamaño declarado supera el máximo, se responde 413 sin firmar.
   * - La policy de S3 repite ambos controles: aunque el cliente mienta el
   *   tamaño o el tipo, S3 rechaza el archivo.
   * - La key no usa datos del cliente: tenant + uuid + extensión del MIME.
   */
  async getPresignedPostUrl(
    contentType: TipoImagenPermitido,
    fileSize: number,
    tenantId: string,
  ): Promise<{ url: string; fields: Record<string, string>; key: string }> {
    if (fileSize > TAMANIO_MAXIMO_IMAGEN_BYTES) {
      throw new PayloadTooLargeException('La imagen supera el máximo de 5 MB');
    }

    const key = `${tenantId}/menu/${uuidv4()}.${EXTENSION_POR_TIPO[contentType]}`;

    const { url, fields } = await createPresignedPost(this.getClient(), {
      Bucket: process.env.S3_BUCKET_IMAGES,
      Key: key,
      Conditions: [
        ['content-length-range', 1, TAMANIO_MAXIMO_IMAGEN_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: TTL_URL_SUBIDA_SEGUNDOS,
    });

    return { url, fields, key };
  }

  /**
   * Una key solo es válida si vive bajo el prefijo del tenant que la usa.
   * Evita que un tenant guarde la key de otro y obtenga una URL firmada
   * para una imagen ajena.
   */
  esKeyDelTenant(key: string, tenantId: string): boolean {
    return key.startsWith(`${tenantId}/menu/`) && !key.includes('..');
  }
}
