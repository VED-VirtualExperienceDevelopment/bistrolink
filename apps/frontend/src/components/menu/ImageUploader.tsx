'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api-client';
import { getKeycloak } from '@/lib/keycloak';
import Image from 'next/image';
import {
  ErrorConfirmacionImagen,
  ErrorSubidaAlmacenamiento,
  mensajeErrorSubida,
  TIPOS_IMAGEN_PERMITIDOS,
  validarImagen,
} from './image-uploader.utils';

interface ImageUploaderProps {
  /**
   * Se llama cuando la imagen ya está verificada y publicada por la API.
   * `key` es la de la imagen procesada ({tenant}/menu/{uuid}.webp), la única
   * que acepta el ítem (BL-387).
   */
  readonly onUploadSuccess: (key: string, previewUrl: string) => void;
  readonly initialPreviewUrl?: string;
  /**
   * HU-043 (BL-533): `marca` para el logo del local. La API lo publica en
   * {tenant}/menu/marca/ y de hasta 512 px. Por defecto, la foto de un ítem.
   */
  readonly destino?: 'item' | 'marca';
  /** Id del campo de archivo, si hay más de un cargador en la pantalla. */
  readonly inputId?: string;
  /** Texto alternativo de la vista previa. */
  readonly altVistaPrevia?: string;
  /** Ids de textos de ayuda del campo (aria-describedby). */
  readonly describidoPor?: string;
}

/** Etapa de la carga, para mostrar qué está pasando. */
type Etapa = 'libre' | 'subiendo' | 'procesando';

const TEXTO_ETAPA: Record<Exclude<Etapa, 'libre'>, string> = {
  subiendo: 'Subiendo imagen…',
  procesando: 'Procesando imagen…',
};

/**
 * BL-388 (BL-385): carga de la imagen de un ítem en tres pasos.
 *
 * 1. Pide a la API una URL firmada de subida (va a la cuarentena).
 * 2. Sube el archivo directo a S3.
 * 3. Pide a la API que lo confirme: la API lo verifica, genera un WebP
 *    nuevo sin metadatos y devuelve la key final y una URL firmada.
 *
 * Mientras tanto se muestra la vista previa local (blob:, BL-384). Al
 * confirmar se reemplaza por la imagen procesada, que es la que va a ver
 * el comensal.
 */
export default function ImageUploader({
  onUploadSuccess,
  initialPreviewUrl,
  destino = 'item',
  inputId = 'image-upload',
  altVistaPrevia = 'Vista previa',
  describidoPor,
}: ImageUploaderProps) {
  const [etapa, setEtapa] = useState<Etapa>('libre');
  const [preview, setPreview] = useState<string | null>(initialPreviewUrl || null);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  // BL-384: vista previa local que sigue en uso (solo si la API no devolvió
  // URL firmada). Se libera al reemplazarla o al cerrar el formulario.
  const vistaPreviaLocalRef = useRef<string | null>(null);

  const liberarVistaPreviaLocal = useCallback(() => {
    if (vistaPreviaLocalRef.current) {
      URL.revokeObjectURL(vistaPreviaLocalRef.current);
      vistaPreviaLocalRef.current = null;
    }
  }, []);

  useEffect(() => liberarVistaPreviaLocal, [liberarVistaPreviaLocal]);

  const ocupado = etapa !== 'libre';

  const procesarArchivo = useCallback(
    async (file: File) => {
      const errorValidacion = validarImagen(file);
      if (errorValidacion) {
        setError(errorValidacion);
        return;
      }

      setError(null);
      setEtapa('subiendo');
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);

      try {
        const keycloak = getKeycloak();

        // 1. URL firmada de subida. Se manda el tamaño para que el backend
        // responda 413 antes de firmar; el nombre del archivo no viaja.
        const { url, fields, key: keyCuarentena } = await apiFetch<{
          url: string;
          fields: Record<string, string>;
          key: string;
        }>('/admin/menu/presigned-url', keycloak.token, {
          method: 'POST',
          body: JSON.stringify({ contentType: file.type, fileSize: file.size }),
        });

        // 2. Subida directa a S3 (cuarentena).
        const formData = new FormData();
        Object.entries(fields).forEach(([k, v]) => formData.append(k, v as string));
        formData.append('file', file);

        const uploadRes = await fetch(url, { method: 'POST', body: formData });
        if (!uploadRes.ok) {
          throw new ErrorSubidaAlmacenamiento(uploadRes.status);
        }

        // 3. Confirmación: la API verifica y publica la imagen procesada.
        setEtapa('procesando');
        let confirmada: { key: string; url: string | null };
        try {
          confirmada = await apiFetch<{ key: string; url: string | null }>(
            '/admin/menu/imagenes/confirmar',
            keycloak.token,
            {
              method: 'POST',
              // HU-043: el destino solo viaja para el logo; la foto de un
              // ítem manda el mismo body que antes.
              body: JSON.stringify(
                destino === 'marca'
                  ? { key: keyCuarentena, destino }
                  : { key: keyCuarentena },
              ),
            },
          );
        } catch (err: unknown) {
          throw new ErrorConfirmacionImagen(err);
        }

        liberarVistaPreviaLocal();
        if (confirmada.url) {
          // Se muestra la imagen procesada; la local ya no hace falta.
          URL.revokeObjectURL(objectUrl);
          setPreview(confirmada.url);
          onUploadSuccess(confirmada.key, confirmada.url);
        } else {
          // Sin URL firmada (falla puntual de S3): se mantiene la local.
          vistaPreviaLocalRef.current = objectUrl;
          onUploadSuccess(confirmada.key, objectUrl);
        }
      } catch (err: unknown) {
        console.error('Error al subir la imagen:', err);
        setError(mensajeErrorSubida(err));
        URL.revokeObjectURL(objectUrl);
        setPreview(initialPreviewUrl || null);
      } finally {
        setEtapa('libre');
      }
    },
    [onUploadSuccess, initialPreviewUrl, liberarVistaPreviaLocal, destino],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Se limpia el input para que elegir de nuevo el mismo archivo
      // (por ejemplo, después de un error) vuelva a disparar onChange.
      e.target.value = '';
      if (file) void procesarArchivo(file);
    },
    [procesarArchivo],
  );

  // C14: arrastrar y soltar un archivo sobre el recuadro.
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      if (!ocupado) setArrastrando(true);
    },
    [ocupado],
  );

  const handleDragLeave = useCallback(() => setArrastrando(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setArrastrando(false);
      if (ocupado) return;
      const file = e.dataTransfer.files?.[0];
      if (file) void procesarArchivo(file);
    },
    [ocupado, procesarArchivo],
  );

  // BL-398 (parte 4c): colores del tema en lugar de hex fijos.
  let estiloBorde =
    'border-outline-variant bg-surface-container-low hover:bg-surface-container';
  if (ocupado || arrastrando) estiloBorde = 'border-primary bg-primary-fixed';
  if (error) estiloBorde = 'border-error bg-error-container';

  return (
    <div className="w-full max-w-xs">
      {/* BL-398: el input ya no es «hidden» sino sr-only, para que se pueda
          elegir la imagen con el teclado (Tab y Enter); el recuadro muestra
          el foco con focus-within. */}
      <label
        htmlFor={inputId}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-busy={ocupado}
        className={`flex h-40 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors duration-200 focus-within:ring-2 focus-within:ring-primary ${estiloBorde}`}
      >
        {preview ? (
          <div className="relative h-full w-full p-2">
            <Image src={preview} alt={altVistaPrevia} fill className="rounded-md object-contain" unoptimized />
            {ocupado && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-on-surface/40">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-on-primary border-t-primary" />
                <span className="text-body-sm font-medium text-on-primary">
                  {TEXTO_ETAPA[etapa as Exclude<Etapa, 'libre'>]}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center px-4 pb-6 pt-5 text-center">
            {ocupado ? (
              <div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            ) : (
              <span className="material-symbols-outlined mb-2 text-[32px] text-on-surface-variant" aria-hidden="true">
                add_photo_alternate
              </span>
            )}
            <p className="mb-1 text-body-md text-on-surface-variant">
              <span className="font-semibold text-primary">Elegí una imagen</span> o
              arrastrala acá
            </p>
            <p className="text-body-sm text-on-surface-variant">
              PNG, JPG o WEBP, hasta 5 MB
            </p>
          </div>
        )}
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept={TIPOS_IMAGEN_PERMITIDOS.join(',')}
          onChange={handleFileChange}
          disabled={ocupado}
          aria-describedby={describidoPor}
        />
      </label>

      {preview && !ocupado && (
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Para cambiarla, elegí o arrastrá otra.
        </p>
      )}

      <p className="sr-only" aria-live="polite">
        {ocupado ? TEXTO_ETAPA[etapa as Exclude<Etapa, 'libre'>] : ''}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
        >
          {error}
        </p>
      )}
    </div>
  );
}
