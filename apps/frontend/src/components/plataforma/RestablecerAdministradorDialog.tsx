"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import type {
  AdministradorFicha,
  ContrasenaRestablecida,
} from "@/types/plataforma";
import {
  mensajeErrorAccesoAdmin,
  nombreDeCuenta,
  rutaRestablecerAdministrador,
} from "./plataforma.utils";
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  ConfirmarCierreSinCopiar,
  ContrasenaTemporal,
} from "./ContrasenaTemporal";

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  tenantId: string;
  administrador: AdministradorFicha;
  /** Después de restablecer (para anunciarlo en la ficha). */
  onRestablecida: () => void;
}

/**
 * BL-414: restablecer la contraseña de un Administrador desde la ficha del
 * establecimiento. Dos pasos, como en Usuarios (BL-359):
 * 1. Confirmación: qué va a pasar (contraseña temporal nueva, la actual deja
 *    de servir, se cierran sus sesiones).
 * 2. La contraseña temporal, una sola vez. Si no se copió, cerrar pide
 *    confirmación (BL-408).
 *
 * La página lo monta de nuevo en cada apertura (key), así que el estado
 * arranca limpio y la contraseña no queda en memoria al cerrar.
 */
export function RestablecerAdministradorDialog({
  open,
  onClose,
  token,
  tenantId,
  administrador,
  onRestablecida,
}: Readonly<Props>) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ContrasenaRestablecida | null>(
    null,
  );
  const [copiada, setCopiada] = useState(false);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const botonCopiar = useRef<HTMLButtonElement>(null);
  const nombre = nombreDeCuenta(administrador);

  // Al pasar a la contraseña, el foco va a «Copiar»: el botón de confirmar
  // desaparece y sin esto el foco se perdería.
  useEffect(() => {
    if (resultado) botonCopiar.current?.focus();
  }, [resultado]);

  // Esc, la X, el clic afuera y «Listo»: con la contraseña sin copiar,
  // primero se pide confirmación.
  const intentarCerrar = () => {
    if (resultado && !copiada && !confirmandoCierre) {
      setConfirmandoCierre(true);
      return;
    }
    onClose();
  };

  const volverALaContrasena = () => {
    setConfirmandoCierre(false);
    requestAnimationFrame(() => botonCopiar.current?.focus());
  };

  const restablecer = async () => {
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await apiFetch<ContrasenaRestablecida>(
        rutaRestablecerAdministrador(tenantId, administrador.id),
        token,
        { method: "POST" },
      );
      setResultado(respuesta);
      onRestablecida();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? mensajeErrorAccesoAdmin(err.status, err.message)
          : "No se pudo restablecer la contraseña",
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onClose={intentarCerrar} title="Restablecer contraseña">
      {resultado ? (
        <div className="space-y-4">
          <p className="text-body-md text-on-surface">
            Contraseña temporal de <strong>{nombre}</strong>
            {administrador.username && (
              <>
                {" "}
                (usuario <strong>{administrador.username}</strong>)
              </>
            )}
            .
          </p>
          <p className="rounded-lg bg-tertiary-fixed px-3 py-2 text-body-md text-on-tertiary-fixed">
            <strong>Solo se muestra ahora.</strong> Pasala por la base KeePass
            del equipo, nunca por chat ni mail. Al ingresar, le va a pedir que
            elija una nueva.
          </p>
          <ContrasenaTemporal
            ref={botonCopiar}
            idBase={`admin-${administrador.id}`}
            contrasena={resultado.temporaryPassword}
            deQuien={nombre}
            copiada={copiada}
            onCopiada={() => setCopiada(true)}
          />

          {!resultado.sesionesCerradas && (
            <p className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
              La contraseña ya cambió, pero no se pudieron cerrar sus sesiones
              abiertas. Si tenía la sesión iniciada en otro dispositivo, puede
              seguir conectado hasta que venza.
            </p>
          )}

          {confirmandoCierre ? (
            <ConfirmarCierreSinCopiar
              onCerrarIgual={onClose}
              onVolver={volverALaContrasena}
            />
          ) : (
            <button
              type="button"
              onClick={intentarCerrar}
              className={`${CLASE_BOTON_PRIMARIO} w-full`}
            >
              Listo
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4 text-body-md text-on-surface">
          <p>
            ¿Restablecer la contraseña de <strong>{nombre}</strong>?
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Se genera una contraseña temporal nueva.</li>
            <li>La contraseña actual deja de servir.</li>
            <li>Se cierran sus sesiones abiertas.</li>
          </ul>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-error-container px-3 py-2 text-on-error-container"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={restablecer}
              data-autofocus
              disabled={enviando}
              aria-busy={enviando}
              className={CLASE_BOTON_PRIMARIO}
            >
              {enviando ? "Restableciendo…" : "Restablecer"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
