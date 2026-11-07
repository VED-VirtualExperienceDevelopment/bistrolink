import { Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

/**
 * HU-009 (BL-454): clave del PDF de un CFE en el bucket, con la convención
 * del Anexo 6 (§8.1): {tenant_id}/cfe/{yyyy}/{mm}/{comprobante_id}.pdf. El
 * año y el mes son los de la emisión en hora de Uruguay.
 */
export function clavePdfCfe(
  tenantId: string,
  fechaEmision: Date,
  comprobanteId: string,
): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(fechaEmision);
  const anio = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  return `${tenantId}/cfe/${anio}/${mes}/${comprobanteId}.pdf`;
}

/** SHA-256 en hexadecimal (64 caracteres). */
export function sha256Hex(contenido: Buffer): string {
  return createHash('sha256').update(contenido).digest('hex');
}

/**
 * HU-009 (BL-454): bucket privado de los CFE (S3_BUCKET_CFE, HU-029). Usa
 * las mismas credenciales de AWS que las imágenes de la carta. Sin la
 * variable, no está configurado: el PDF se sigue pidiendo a Surtec.
 *
 * El cliente se crea en el primer uso, como en StorageService: si faltan las
 * variables, la API levanta igual.
 */
@Injectable()
export class AlmacenCfe {
  private cliente: S3Client | null = null;

  configurado(): boolean {
    return !!process.env.S3_BUCKET_CFE?.trim();
  }

  private s3(): S3Client {
    this.cliente ??= new S3Client({
      region: process.env.AWS_REGION || 'auto',
      endpoint: process.env.AWS_S3_ENDPOINT,
      forcePathStyle: !!process.env.AWS_S3_ENDPOINT,
    });
    return this.cliente;
  }

  /**
   * Guarda el PDF. S3 verifica el checksum SHA-256 al recibirlo (también lo
   * exige un bucket con Object Lock).
   */
  async guardarPdf(clave: string, contenido: Buffer): Promise<void> {
    await this.s3().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_CFE,
        Key: clave,
        Body: contenido,
        ContentType: 'application/pdf',
        ChecksumAlgorithm: 'SHA256',
      }),
    );
  }

  async leer(clave: string): Promise<Buffer> {
    const respuesta = await this.s3().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET_CFE, Key: clave }),
    );
    if (!respuesta.Body) {
      throw new Error('S3 devolvió el objeto sin contenido');
    }
    return Buffer.from(await respuesta.Body.transformToByteArray());
  }
}
