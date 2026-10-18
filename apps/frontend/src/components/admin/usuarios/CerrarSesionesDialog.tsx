'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { CerrarSesionesResponse, Usuario } from '@/types/usuario';
import { esCuentaCocina, nombreParaMostrar, rutaUsuario } from './Usuarios.utils';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  usuario: Usuario | null;
}

/**
 * BL-367: cerrar las sesiones abiertas de una persona en todos sus
 * dispositivos, sin desactivarla (por ejemplo, una tablet compartida que
 * quedó con la sesión de alguien que ya terminó el turno). Mismo patrón que
 * ReactivarUsuarioDialog; al terminar, confirma en el mismo diálogo.
 */
export function CerrarSesionesDialog({ open, onClose, token, usuario }: Readonly<Props>) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const entendidoRef = useRef<HTMLButtonElement>(null);

  // Al confirmar, el botón «Cerrar sesiones» desaparece: el foco pasa a
  // «Entendido» para no quedar perdido fuera del diálogo (el Dialog solo
  // ubica el foco al abrirse).
  useEffect(() => {
    if (listo) entendidoRef.current?.focus();
  }, [listo]);

  if (!usuario) return null;

  const nombre = nombreParaMostrar(usuario);
  const cocina = esCuentaCocina(usuario);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<CerrarSesionesResponse>(`${rutaUsuario(usuario)}/cerrar-sesiones`, token, {
        method: 'POST',
      });
      setListo(true);
    } catch (err) {
      // El 503 («No se pudieron cerrar las sesiones. Probá de nuevo…») llega
      // con el mensaje del backend: se muestra tal cual.
      setError(err instanceof ApiError ? err.message : 'No se pudieron cerrar las sesiones');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Cerrar sesiones">
      {listo ? (
        <div className="space-y-4">
          {/* <output> (rol «status» implícito): el lector de pantalla anuncia
              el resultado sin mover el foco. */}
          <output className="block text-body-md text-on-surface">
            Listo: se cerraron las sesiones de {nombre}. Si tenía la aplicación abierta, puede
            seguir viéndola hasta 15 minutos; después le va a pedir que ingrese de nuevo.
          </output>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              ref={entendidoRef}
              className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90"
            >
              Entendido
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-body-md text-on-surface">
            Se va a cerrar la sesión de {nombre} en todos sus dispositivos. Sigue activo y puede
            volver a ingresar con su usuario y su contraseña.
          </p>
          {cocina && (
            <p className="text-body-md text-on-surface-variant">
              Es la cuenta compartida de la cocina: se cierra en todas las pantallas de la cocina.
            </p>
          )}
          <p className="text-body-md text-on-surface-variant">
            Si tiene la aplicación abierta, puede seguir viéndola hasta 15 minutos.
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
              {submitting ? 'Cerrando…' : 'Cerrar sesiones'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
