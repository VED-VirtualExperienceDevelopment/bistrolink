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
export default function ImageUploader({ onUploadSuccess, initialPreviewUrl }: ImageUploaderProps) {
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
            { method: 'POST', body: JSON.stringify({ key: keyCuarentena }) },
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
    [onUploadSuccess, initialPreviewUrl, liberarVistaPreviaLocal],
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

  let estiloBorde = 'border-[#79767D]/30 bg-gray-50 hover:bg-gray-100';
  if (ocupado || arrastrando) estiloBorde = 'border-[#8069BF] bg-[#8069BF]/5';
  if (error) estiloBorde = 'border-red-300 bg-red-50';

  return (
    <div className="w-full max-w-xs">
      <label
        htmlFor="image-upload"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-busy={ocupado}
        className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 ${estiloBorde}`}
      >
        {preview ? (
          <div className="relative w-full h-full p-2">
            <Image src={preview} alt="Vista previa" fill className="object-contain rounded-md" unoptimized />
            {ocupado && (
              <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2 rounded-md">
                <div className="w-8 h-8 border-4 border-white border-t-[#8069BF] rounded-full animate-spin" />
                <span className="text-xs font-medium text-white">{TEXTO_ETAPA[etapa as Exclude<Etapa, 'libre'>]}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            {ocupado ? (
              <div className="w-8 h-8 border-4 border-[#8069BF] border-t-transparent rounded-full animate-spin mb-2" />
            ) : (
              <svg className="w-8 h-8 mb-3 text-[#79767D]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            )}
            <p className="mb-1 text-sm text-[#79767D]">
              <span className="font-semibold text-[#8069BF]">Click para subir</span> o arrastrá
            </p>
            <p className="text-xs text-[#79767D]/70">PNG, JPG o WEBP (Máx. 5MB)</p>
          </div>
        )}
        <input id="image-upload" type="file" className="hidden" accept={TIPOS_IMAGEN_PERMITIDOS.join(',')} onChange={handleFileChange} disabled={ocupado} />
      </label>

      <p className="sr-only" aria-live="polite">
        {ocupado ? TEXTO_ETAPA[etapa as Exclude<Etapa, 'libre'>] : ''}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-amber-600 text-center font-medium bg-amber-50 py-1 px-2 rounded border border-amber-200">
          ⚠️ {error}
        </p>
      )}
    </div>
  );
}
