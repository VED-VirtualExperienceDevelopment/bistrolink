"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { DesbloquearResponse, Usuario } from "@/types/usuario";
import {
  esCuentaCocina,
  nombreParaMostrar,
  rutaUsuario,
} from "./Usuarios.utils";

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  usuario: Usuario | null;
  onDesbloqueado: (id: string) => void;
}

/**
 * BL-371: levantar el bloqueo por intentos fallidos sin esperar a que venza.
 * Mismo patrón que ReactivarUsuarioDialog. No cambia la contraseña: si la
 * persona no la recuerda, está «Restablecer contraseña».
 */
export function DesbloquearUsuarioDialog({
  open,
  onClose,
  token,
  usuario,
  onDesbloqueado,
}: Readonly<Props>) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!usuario) return null;

  const nombre = nombreParaMostrar(usuario);
  const cocina = esCuentaCocina(usuario);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<DesbloquearResponse>(
        `${rutaUsuario(usuario)}/desbloquear`,
        token,
        {
          method: "POST",
        },
      );
      onDesbloqueado(res.id);
      onClose();
    } catch (err) {
      // El 503 («No se pudo desbloquear la cuenta. Probá de nuevo…») llega
      // con el mensaje del backend: se muestra tal cual.
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo desbloquear la cuenta",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Desbloquear cuenta">
      <div className="space-y-4">
        <p className="text-body-md text-on-surface">
          La cuenta de {nombre} quedó bloqueada por varios intentos fallidos de
          ingreso. Al desbloquearla, puede volver a ingresar enseguida con su
          contraseña de siempre.
        </p>
        {cocina && (
          <p className="text-body-md text-on-surface-variant">
            Es la cuenta compartida de la cocina: se desbloquea para todas las
            pantallas de la cocina.
          </p>
        )}
        <p className="text-body-md text-on-surface-variant">
          Si no recuerda la contraseña, usá «Restablecer contraseña». Si nadie
          de tu equipo intentó ingresar, puede ser alguien probando contraseñas:
          conviene restablecerla.
        </p>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
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
            {submitting ? "Desbloqueando…" : "Desbloquear"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
