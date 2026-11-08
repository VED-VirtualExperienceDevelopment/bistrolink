'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { ReactivarResponse, Usuario } from '@/types/usuario';
import { nombreParaMostrar, rutaUsuario } from './Usuarios.utils';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  usuario: Usuario | null;
  onReactivado: (id: string) => void;
}

// BL-358: confirmación antes de volver a habilitar a un usuario desactivado.
// Mismo patrón que DesactivarUsuarioDialog.
export function ReactivarUsuarioDialog({ open, onClose, token, usuario, onReactivado }: Readonly<Props>) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!usuario) return null;

  const nombre = nombreParaMostrar(usuario);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<ReactivarResponse>(`${rutaUsuario(usuario)}/activar`, token, {
        method: 'PATCH',
      });
      onReactivado(res.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo reactivar el usuario');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Reactivar usuario">
      <div className="space-y-4">
        <p className="text-body-md text-on-surface">
          ¿Reactivar a {nombre}? Va a poder volver a ingresar con su usuario y su contraseña, y
          conserva el rol que tenía.
        </p>

        {error && (
          <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            data-autofocus
            disabled={submitting}
            className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Reactivando…' : 'Reactivar'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
