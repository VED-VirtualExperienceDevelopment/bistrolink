import { Injectable } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
      this.s3Client = new S3Client({ region: process.env.AWS_REGION });
    }
    return this.s3Client;
  }

  async getSignedImageUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_IMAGES,
      Key: key,
    });
    return getSignedUrl(this.getClient(), command, {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }
}
