import {
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'node:crypto';
import {
  CACHE_CONTROL_IMAGEN_PUBLICADA,
  CONTENT_TYPE_IMAGEN_PUBLICADA,
  PATRON_UUID,
  PREFIJO_CUARENTENA,
  TAMANIO_MAXIMO_IMAGEN_BYTES,
  TipoImagenPermitido,
  TTL_URL_LECTURA_SEGUNDOS,
  TTL_URL_SUBIDA_SEGUNDOS,
} from './upload.constants';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

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
      // BL-387: la respuesta de S3 la fija la firma, no lo que declaró quien
      // subió el archivo. Las imágenes procesadas son WebP; las viejas (antes
      // del reprocesamiento, BL-390) conservan su tipo, pero igual se entregan
      // para mostrar, nunca como descarga.
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_IMAGES,
        Key: key,
        ResponseContentDisposition: 'inline',
        ...(key.endsWith('.webp')
          ? { ResponseContentType: CONTENT_TYPE_IMAGEN_PUBLICADA }
          : {}),
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
   * - La key no usa datos del cliente: prefijo de cuarentena + tenant + uuid.
   *
   * BL-385: el archivo sube a la CUARENTENA (incoming/{tenant}/{uuid}). S3
   * solo controla el tipo declarado, no el contenido, así que lo subido no
   * se publica: la API lo verifica y lo reprocesa en la confirmación.
   */
  async getPresignedPostUrl(
    contentType: TipoImagenPermitido,
    fileSize: number,
    tenantId: string,
  ): Promise<{ url: string; fields: Record<string, string>; key: string }> {
    if (fileSize > TAMANIO_MAXIMO_IMAGEN_BYTES) {
      throw new PayloadTooLargeException('La imagen supera el máximo de 5 MB');
    }

    const key = `${PREFIJO_CUARENTENA}/${tenantId}/${randomUUID()}`;

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
   * BL-385: una key de cuarentena es válida solo si tiene exactamente el
   * formato incoming/{tenant del token}/{uuid}. Con expresión regular
   * completa (no solo prefijo): no admite barras extra, "..", extensiones
   * ni mayúsculas.
   *
   * Devuelve el uuid si es válida, o null si no.
   */
  uuidDeKeyDeCuarentena(key: string, tenantId: string): string | null {
    const patron = new RegExp(
      `^${PREFIJO_CUARENTENA}/${escaparRegex(tenantId)}/(${PATRON_UUID})$`,
    );
    const coincidencia = patron.exec(key);
    return coincidencia ? coincidencia[1] : null;
  }

  /**
   * BL-385: lee de la cuarentena el archivo que subió el navegador.
   *
   * - Primero consulta el tamaño REAL (HeadObject), sin descargarlo.
   * - Si no existe (no se subió o ya venció), responde 404.
   * - Si pasa de 5 MB, responde 413 sin descargarlo.
   */
  async leerDeCuarentena(key: string): Promise<Buffer> {
    const bucket = process.env.S3_BUCKET_IMAGES;

    let tamanio: number | undefined;
    try {
      const cabecera = await this.getClient().send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      tamanio = cabecera.ContentLength;
    } catch (error) {
      if (esNoEncontrado(error)) {
        throw new NotFoundException(
          'No se encontró la imagen subida. Volvé a elegir el archivo.',
        );
      }
      throw error;
    }

    if (!tamanio || tamanio > TAMANIO_MAXIMO_IMAGEN_BYTES) {
      throw new PayloadTooLargeException('La imagen supera el máximo de 5 MB');
    }

    const respuesta = await this.getClient().send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!respuesta.Body) {
      throw new NotFoundException(
        'No se encontró la imagen subida. Volvé a elegir el archivo.',
      );
    }
    return Buffer.from(await respuesta.Body.transformToByteArray());
  }

  /**
   * BL-385: guarda la imagen que generó el servidor. El tipo y la caché los
   * fija la API; nada de lo que declaró el navegador llega a este objeto.
   */
  async guardarImagenPublicada(key: string, contenido: Buffer): Promise<void> {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_IMAGES,
        Key: key,
        Body: contenido,
        ContentType: CONTENT_TYPE_IMAGEN_PUBLICADA,
        CacheControl: CACHE_CONTROL_IMAGEN_PUBLICADA,
      }),
    );
    this.logger.log(`Imagen publicada (${contenido.length} bytes)`);
  }

  /**
   * Una key solo es válida si es una imagen PUBLICADA del tenant que la usa.
   * Evita que un tenant guarde la key de otro y obtenga una URL firmada
   * para una imagen ajena (BL-54).
   *
   * BL-387: formato exacto {tenant}/menu/{uuid}.webp, el que genera la
   * confirmación (BL-386). Así se rechazan las keys de la cuarentena, las de
   * otro tenant, las que tienen barras extra o "..", y cualquier archivo que
   * no haya pasado por el procesador.
   */
  esKeyDelTenant(key: string, tenantId: string): boolean {
    const patron = new RegExp(
      `^${escaparRegex(tenantId)}/menu/${PATRON_UUID}\\.webp$`,
    );
    return patron.test(key);
  }

  /**
   * BL-387: el objeto existe en el bucket (HeadObject, sin descargarlo).
   * Evita asociar a un ítem una key bien formada pero que nunca se publicó.
   */
  async existeImagen(key: string): Promise<boolean> {
    try {
      await this.getClient().send(
        new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET_IMAGES,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      if (esNoEncontrado(error)) return false;
      throw error;
    }
  }
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function esNoEncontrado(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}
