'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { DesactivarResponse, Usuario } from '@/types/usuario';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  usuario: Usuario | null;
  onDesactivado: (id: string) => void;
}

export function DesactivarUsuarioDialog({ open, onClose, token, usuario, onDesactivado }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!usuario) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<DesactivarResponse>(`/usuarios/${usuario.id}`, token, {
        method: 'DELETE',
      });
      onDesactivado(res.id);
      onClose();
    } catch (err) {
      // RF.19: "no se puede desactivar al último Admin del tenant" llega acá
      // como 409 — mostramos el mensaje del backend, sin reinterpretarlo.
      setError(err instanceof ApiError ? err.message : 'No se pudo desactivar el usuario');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Desactivar usuario">
      <div className="space-y-4">
        <p className="text-body-md text-on-surface">
          {usuario.username ?? `Usuario ${usuario.id.slice(0, 8)}`} no va a poder iniciar sesión
          hasta que se reactive. Esta acción no borra su historial.
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
            className="rounded-lg px-4 py-2 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="rounded-lg bg-error px-4 py-2 text-body-md font-medium text-on-error hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Desactivando…' : 'Desactivar'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}