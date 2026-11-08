'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { EliminarResponse, Usuario } from '@/types/usuario';
import { nombreParaMostrar } from './Usuarios.utils';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  usuario: Usuario | null;
  onEliminado: (id: string) => void;
}

/**
 * BL-382: eliminar definitivamente a un usuario creado por error (solo se
 * ofrece si no tiene historial). Mismo patrón que DesactivarUsuarioDialog:
 * el foco inicial va a «Cancelar», porque no se puede deshacer.
 */
export function EliminarUsuarioDialog({
  open,
  onClose,
  token,
  usuario,
  onEliminado,
}: Readonly<Props>) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!usuario) return null;

  const nombre = nombreParaMostrar(usuario);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<EliminarResponse>(`/usuarios/${usuario.id}/permanente`, token, {
        method: 'DELETE',
      });
      onEliminado(res.id);
      onClose();
    } catch (err) {
      // 409 si tiene historial (por ejemplo, tomó un pedido después de
      // cargar la pantalla) o si es el último Admin: el mensaje del backend
      // dice qué hacer.
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar el usuario');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Eliminar usuario">
      <div className="space-y-4">
        <p className="text-body-md text-on-surface">
          ¿Eliminar a {nombre}? Se borra su usuario y ya no va a poder ingresar.
        </p>
        <p className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
          No se puede deshacer. Si solo querés que deje de ingresar por un tiempo, usá «Desactivar».
        </p>

        {error && (
          <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            data-autofocus
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="min-h-12 rounded-lg bg-error px-4 text-body-md font-medium text-on-error hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
