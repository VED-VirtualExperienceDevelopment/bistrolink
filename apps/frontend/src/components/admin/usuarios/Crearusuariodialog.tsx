'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { CrearUsuarioResponse, UsuarioRol } from '@/types/usuario';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  restauranteId: string;
  onCreated: (usuario: CrearUsuarioResponse) => void;
}

export function CrearUsuarioDialog({ open, onClose, token, restauranteId, onCreated }: Props) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<UsuarioRol>('MOZO');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<CrearUsuarioResponse | null>(null);

  const resetAndClose = () => {
    setUsername('');
    setEmail('');
    setRol('MOZO');
    setError(null);
    setCreado(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const usuario = await apiFetch<CrearUsuarioResponse>('/usuarios', token, {
        method: 'POST',
        body: JSON.stringify({
          username,
          email: email || undefined,
          rol,
          restauranteId,
        }),
      });
      setCreado(usuario);
      onCreated(usuario);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={resetAndClose} title="Nuevo usuario">
      {creado ? (
        <div className="space-y-4">
          <p className="text-body-md text-on-surface">
            Usuario <strong>{username}</strong> creado. Esta contraseña temporal solo se
            muestra una vez — copiala antes de cerrar esta ventana.
          </p>
          <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
            <code className="text-body-md text-on-surface">{creado.temporaryPassword}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(creado.temporaryPassword)}
              className="text-label-md font-semibold text-primary hover:underline"
            >
              Copiar
            </button>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="w-full rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90"
          >
            Listo
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1 block text-label-md text-on-surface-variant">
              Nombre de usuario
            </label>
            <input
              id="username"
              required
              minLength={3}
              autoComplete='off'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-outline-variant px-3 py-2 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-label-md text-on-surface-variant">
              Email (opcional)
            </label>
            <input
              id="email"
              type="email"
              autoComplete='off'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-outline-variant px-3 py-2 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label htmlFor="rol" className="mb-1 block text-label-md text-on-surface-variant">
              Rol
            </label>
            <select
              id="rol"
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
              onClick={resetAndClose}
              className="rounded-lg px-4 py-2 text-body-md text-on-surface-variant hover:bg-surface-container"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}