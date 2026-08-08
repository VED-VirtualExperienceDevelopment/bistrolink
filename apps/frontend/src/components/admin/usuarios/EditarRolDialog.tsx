'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { Usuario, UsuarioRol } from '@/types/usuario';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  usuario: Usuario | null;
  onUpdated: (usuario: Usuario) => void;
}

export function EditarRolDialog({ open, onClose, token, usuario, onUpdated }: Props) {
  const [rol, setRol] = useState<UsuarioRol>(usuario?.rol ?? 'MOZO');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!usuario) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const actualizado = await apiFetch<Usuario>(`/usuarios/${usuario.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ rol }),
      });
      onUpdated(actualizado);
      onClose();
    } catch (err) {
      // El 409 de RF.19 ("no se puede degradar al último Admin") llega acá
      // con el mensaje que ya redactó el backend — se muestra tal cual.
      setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el rol');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Editar rol — ${usuario.username ?? usuario.id.slice(0, 8)}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="rol-edit" className="mb-1 block text-label-md text-on-surface-variant">
            Rol
          </label>
          <select
            id="rol-edit"
            value={rol}
            onChange={(e) => setRol(e.target.value as UsuarioRol)}
            className="w-full rounded-lg border border-outline-variant px-3 py-2 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="MOZO">Mozo</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </div>

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
            type="submit"
            disabled={submitting || rol === usuario.rol}
            className="rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}