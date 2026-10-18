'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { RestablecerContrasenaResponse, Usuario } from '@/types/usuario';
import { nombreParaMostrar, rutaUsuario } from './Usuarios.utils';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  usuario: Usuario | null;
}

// BL-359: dos pasos. Primero la confirmación; después, la contraseña
// temporal, que se muestra una sola vez (igual que en el alta).
export function RestablecerContrasenaDialog({ open, onClose, token, usuario }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<RestablecerContrasenaResponse | null>(null);
  const [copiada, setCopiada] = useState(false);

  if (!usuario) return null;

  const nombre = nombreParaMostrar(usuario);

  // El componente sigue montado entre aperturas: al cerrar se borra todo,
  // para que la contraseña no quede en memoria ni aparezca en otra fila.
  const handleClose = () => {
    setResultado(null);
    setError(null);
    setCopiada(false);
    onClose();
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<RestablecerContrasenaResponse>(
        `${rutaUsuario(usuario)}/restablecer-contrasena`,
        token,
        { method: 'POST' },
      );
      setResultado(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo restablecer la contraseña');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!resultado) return;
    try {
      await navigator.clipboard.writeText(resultado.temporaryPassword);
      setCopiada(true);
    } catch {
      // Sin permiso de portapapeles: la contraseña sigue a la vista para copiarla a mano.
      setCopiada(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Restablecer contraseña">
      {resultado ? (
        <div className="space-y-4">
          <p className="text-body-md text-on-surface">
            Contraseña temporal de <strong>{nombre}</strong>. Solo se muestra esta vez: copiala
            antes de cerrar esta ventana. Al ingresar, le va a pedir que elija una nueva.
          </p>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
            <code className="break-all text-body-md text-on-surface">{resultado.temporaryPassword}</code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 text-label-md font-semibold text-primary hover:underline"
            >
              {copiada ? 'Copiada' : 'Copiar'}
            </button>
          </div>
          {/* Anuncia la copia al lector de pantalla. */}
          <p className="sr-only" aria-live="polite">
            {copiada ? 'Contraseña copiada al portapapeles' : ''}
          </p>

          {!resultado.sesionesCerradas && (
            <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
              La contraseña ya cambió, pero no se pudieron cerrar sus sesiones abiertas. Si tenía
              la sesión iniciada en otro dispositivo, puede seguir conectado hasta que venza.
            </p>
          )}

          <button
            type="button"
            onClick={handleClose}
            className="w-full rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90"
          >
            Listo
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-body-md text-on-surface">
            ¿Restablecer la contraseña de {nombre}? Se genera una contraseña temporal nueva, la
            actual deja de servir y se cierran sus sesiones abiertas.
          </p>

          {error && (
            <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-body-md text-on-surface-variant hover:bg-surface-container"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Restableciendo…' : 'Restablecer'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
