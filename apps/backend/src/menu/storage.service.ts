import { Injectable } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { v4 as uuidv4 } from 'uuid';

// TTL de la URL firmada — criterio de seguridad de HU-001:
// "las imágenes se sirven vía URLs firmadas con TTL, no URLs públicas permanentes".
const SIGNED_URL_TTL_SECONDS = 3600;

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

  // <-- MODIFICADO: Ahora usa S3_BUCKET_IMAGES (sin prefijo AWS_) para respetar
  // las variables de entorno existentes del proyecto.
  async getSignedImageUrl(key: string): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_IMAGES, // <-- CAMBIO CLAVE
        Key: key,
      });
      return await getSignedUrl(this.getClient(), command, {
        expiresIn: SIGNED_URL_TTL_SECONDS,
      });
    } catch (error) {
      // No dejamos que un problema de S3 (bucket mal configurado, credenciales
      // vencidas, etc.) tire abajo el menú entero — el comensal sigue viendo
      // nombre/descripción/precio, solo sin imagen para ese ítem puntual.
      console.error(`No se pudo generar la URL firmada para "${key}":`, error);
      return null;
    }
  }

  // <-- NUEVO: Genera URL firmada para SUBIDA directa desde el frontend (S3/R2)
  async getPresignedPostUrl(
    fileName: string,
    contentType: string,
    tenantId: string,
  ): Promise<{ url: string; fields: Record<string, string>; key: string }> {
    // Generamos una key única con el tenantId como prefijo para organización
    const key = `${tenantId}/menu/${uuidv4()}-${fileName.replace(/\s+/g, '_')}`;

    const { url, fields } = await createPresignedPost(this.getClient(), {
      Bucket: process.env.S3_BUCKET_IMAGES, // <-- CAMBIO CLAVE
      Key: key,
      Conditions: [
        ['content-length-range', 0, 5 * 1024 * 1024], // Máx 5MB
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: 300, // 5 minutos para completar la subida
    });

    return { url, fields, key };
  }
}
