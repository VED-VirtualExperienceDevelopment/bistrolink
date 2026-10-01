'use client';

import { useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';
import { getKeycloak } from '@/lib/keycloak';
import Image from 'next/image';

interface ImageUploaderProps {
  readonly onUploadSuccess: (key: string, previewUrl: string) => void;
  readonly initialPreviewUrl?: string;
}

export default function ImageUploader({
  onUploadSuccess,
  initialPreviewUrl,
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(
    initialPreviewUrl || null,
  );
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        setError('Solo se permiten archivos de imagen.');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError('La imagen no debe superar los 5MB.');
        return;
      }

      setUploading(true);
      setError(null);
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);

      try {
        const keycloak = getKeycloak();

        const { url, fields, key } = await apiFetch<{
          url: string;
          fields: Record<string, string>;
          key: string;
        }>('/admin/menu/presigned-url', keycloak.token, {
          method: 'POST',
          body: JSON.stringify({ fileName: file.name, contentType: file.type }),
        });

        const formData = new FormData();
        Object.entries(fields).forEach(([k, v]) => formData.append(k, v as string));
        formData.append('file', file);

        const uploadRes = await fetch(url, { method: 'POST', body: formData });

        if (!uploadRes.ok) {
          throw new Error('AWS_UPLOAD_FAILED');
        }

        onUploadSuccess(key, objectUrl);
      } catch (err: any) {
        console.error('❌ Error en ImageUploader:', err);
        setError('Aún necesita configuración de AWS - WIP');
        setPreview(initialPreviewUrl || null);
      } finally {
        setUploading(false);
      }
    },
    [onUploadSuccess, initialPreviewUrl],
  );

  return (
    <div className="w-full max-w-xs">
      <label
        htmlFor="image-upload"
        className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 ${
          uploading
            ? 'border-[#8069BF] bg-[#8069BF]/5'
            : 'border-[#79767D]/30 bg-gray-50 hover:bg-gray-100'
        } ${error ? 'border-red-300 bg-red-50' : ''}`}
      >
        {preview ? (
          <div className="relative w-full h-full p-2">
            <Image
              src={preview}
              alt="Vista previa"
              fill
              className="object-contain rounded-md"
              unoptimized
            />
            {uploading && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-md">
                <div className="w-8 h-8 border-4 border-white border-t-[#8069BF] rounded-full animate-spin" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            {uploading ? (
              <div className="w-8 h-8 border-4 border-[#8069BF] border-t-transparent rounded-full animate-spin mb-2" />
            ) : (
              <svg
                className="w-8 h-8 mb-3 text-[#79767D]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            )}
            <p className="mb-1 text-sm text-[#79767D]">
              <span className="font-semibold text-[#8069BF]">
                Click para subir
              </span>{' '}
              o arrastra
            </p>
            <p className="text-xs text-[#79767D]/70">
              PNG, JPG o WEBP (Máx. 5MB)
            </p>
          </div>
        )}
        <input
          id="image-upload"
          type="file"
          className="hidden"
          accept="image/*"
          onChange={handleFileChange}
          disabled={uploading}
        />
      </label>

      {error && (
        <p className="mt-2 text-sm text-amber-600 text-center font-medium bg-amber-50 py-1 px-2 rounded border border-amber-200">
          ⚠️ {error}
        </p>
      )}
    </div>
  );
}
