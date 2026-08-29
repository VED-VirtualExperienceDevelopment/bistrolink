'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';

// SHA corto (7 caracteres, igual a la convención de GitHub) para el badge.
// El completo se muestra dentro del diálogo.
const FRONTEND_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown';
const FRONTEND_VERSION_SHORT =
  FRONTEND_VERSION === 'unknown' ? 'unknown' : FRONTEND_VERSION.slice(0, 7);

type LastMigration =
  | { name: string; label: string; appliedAt: string }
  | 'unavailable';

interface BackendVersion {
  api: string;
  postgres: string;
  lastMigration: LastMigration;
  upToDate: boolean | 'unavailable';
}

export function VersionInfo() {
  const [open, setOpen] = useState(false);
  const [backend, setBackend] = useState<BackendVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch perezoso: recién al abrir el diálogo, no en cada carga de página —
  // este dato es de diagnóstico, no algo que valga la pena pedir de entrada.
  const handleOpen = async () => {
    setOpen(true);
    if (backend || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/health/version`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BackendVersion = await res.json();
      setBackend(data);
    } catch {
      setError('No se pudo obtener la versión del backend.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Ver información de versión"
        className="fixed bottom-3 right-3 z-40 rounded-full border border-outline-variant bg-surface-container-lowest px-3 py-1 text-label-sm text-on-surface-variant shadow-sm hover:bg-surface-container-high"
      >
        v{FRONTEND_VERSION_SHORT}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Información de versión"
      >
        <dl className="space-y-3 text-body-md text-on-surface">
          <div>
            <dt className="text-label-sm text-on-surface-variant">
              Frontend
            </dt>
            <dd className="font-mono">{FRONTEND_VERSION}</dd>
          </div>

          {loading && (
            <p className="text-label-sm text-on-surface-variant">
              Consultando backend...
            </p>
          )}

          {error && (
            <p className="text-label-sm text-error">{error}</p>
          )}

          {backend && (
            <>
              <div>
                <dt className="text-label-sm text-on-surface-variant">
                  Backend (API)
                </dt>
                <dd className="font-mono">{backend.api}</dd>
              </div>
              <div>
                <dt className="text-label-sm text-on-surface-variant">
                  PostgreSQL
                </dt>
                <dd className="font-mono break-words">{backend.postgres}</dd>
              </div>
              <div>
                <dt className="text-label-sm text-on-surface-variant">
                  Última migración
                </dt>
                <dd className="font-mono break-words">
                  {backend.lastMigration === 'unavailable'
                    ? 'no disponible'
                    : backend.lastMigration.label}
                </dd>
              </div>
              <div>
                <dt className="text-label-sm text-on-surface-variant">
                  Esquema actualizado
                </dt>
                <dd className="font-mono">
                  {backend.upToDate === 'unavailable'
                    ? 'no disponible'
                    : backend.upToDate
                      ? 'sí'
                      : 'no'}
                </dd>
              </div>
            </>
          )}
        </dl>
      </Dialog>
    </>
  );
}