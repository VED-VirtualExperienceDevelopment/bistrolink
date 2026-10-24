"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { FichaEstablecimiento } from "@/types/plataforma";
import {
  avisoPedidosAbiertos,
  errorDeMotivo,
  LARGO_MAXIMO_MOTIVO,
  mensajeErrorCambioEstado,
  motivoLimpio,
  rutaReactivar,
  rutaSuspender,
} from "./plataforma.utils";

export type AccionEstado = "suspender" | "reactivar";

interface Props {
  accion: AccionEstado;
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  ficha: FichaEstablecimiento;
  /** Recibe la ficha actualizada que devuelve la API. */
  onActualizado: (ficha: FichaEstablecimiento) => void;
}

const ID_MOTIVO = "suspender-motivo";

const CLASE_BOTON_SECUNDARIO =
  "min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container";

/**
 * BL-413: confirmar la suspensión o la reactivación de un establecimiento.
 *
 * Suspender pide el motivo (obligatorio, de 3 a 200 caracteres, como el
 * DTO) y explica qué pasa: nadie del restaurante puede operar, el menú
 * público queda «no disponible», se cierran las sesiones y no se borra
 * nada. Si hay pedidos abiertos, lo avisa (no se cancelan).
 *
 * Mismos lineamientos que «Editar» (BL-412): el error del campo aparece
 * recién después del primer intento, con aria-invalid y aria-describedby, y
 * el foco vuelve al campo. La página lo monta de nuevo cada vez que se abre
 * (key), así no queda el motivo anterior.
 */
export function CambiarEstadoEstablecimientoDialog({
  accion,
  open,
  onClose,
  token,
  ficha,
  onActualizado,
}: Readonly<Props>) {
  const [motivo, setMotivo] = useState("");
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suspender = accion === "suspender";
  const errorMotivo = suspender && intento ? errorDeMotivo(motivo) : undefined;
  const aviso = suspender
    ? avisoPedidosAbiertos(ficha.resumen?.pedidosAbiertos)
    : null;

  const confirmar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const actualizada = await apiFetch<FichaEstablecimiento>(
        suspender
          ? rutaSuspender(ficha.tenantId)
          : rutaReactivar(ficha.tenantId),
        token,
        suspender
          ? {
              method: "POST",
              body: JSON.stringify({ motivo: motivoLimpio(motivo) }),
            }
          : { method: "POST" },
      );
      onActualizado(actualizada);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? mensajeErrorCambioEstado(err.status, err.message)
          : "No se pudo cambiar el estado del establecimiento",
      );
    } finally {
      setEnviando(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (suspender) {
      setIntento(true);
      if (errorDeMotivo(motivo)) {
        document.getElementById(ID_MOTIVO)?.focus();
        return;
      }
    }
    void confirmar();
  };

  const descripcionMotivo = [
    `${ID_MOTIVO}-ayuda`,
    errorMotivo && `${ID_MOTIVO}-error`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        suspender
          ? `¿Suspender ${ficha.razonSocial}?`
          : `¿Reactivar ${ficha.razonSocial}?`
      }
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-4 text-body-md text-on-surface"
        noValidate
      >
        {suspender ? (
          <>
            <p>Mientras esté suspendido:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                El Administrador, los mozos y la cocina no pueden operar, y se
                cierran sus sesiones abiertas.
              </li>
              <li>
                El menú y el QR de las mesas muestran «Este restaurante no está
                disponible por el momento» y no se pueden hacer pedidos.
              </li>
              <li>
                No se borra ningún dato: al reactivarlo queda como estaba.
              </li>
            </ul>

            {aviso && (
              <p className="rounded-lg bg-tertiary-fixed px-3 py-2 text-on-tertiary-fixed">
                {aviso}
              </p>
            )}

            <div>
              <label
                htmlFor={ID_MOTIVO}
                className="mb-1 block text-label-md text-on-surface-variant"
              >
                Motivo
              </label>
              <textarea
                id={ID_MOTIVO}
                data-autofocus
                rows={3}
                maxLength={LARGO_MAXIMO_MOTIVO}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                aria-invalid={errorMotivo ? true : undefined}
                aria-describedby={descripcionMotivo}
                className={`min-h-12 w-full rounded-lg border bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${errorMotivo ? "border-error" : "border-outline-variant"}`}
              />
              <p
                id={`${ID_MOTIVO}-ayuda`}
                className="mt-1 text-body-sm text-on-surface-variant"
              >
                Queda en la ficha y en la auditoría. No lo ve el restaurante ni
                los comensales.
              </p>
              {errorMotivo && (
                <p
                  id={`${ID_MOTIVO}-error`}
                  className="mt-1 text-body-sm text-error"
                >
                  {errorMotivo}
                </p>
              )}
            </div>
          </>
        ) : (
          <p>
            El restaurante vuelve a operar como antes de la suspensión: el
            personal entra con su usuario y su contraseña de siempre, y el menú
            y los QR vuelven a funcionar.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
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
            type="submit"
            disabled={enviando}
            {...(suspender ? {} : { "data-autofocus": true })}
            className={
              suspender
                ? "min-h-12 rounded-lg bg-error px-4 text-body-md font-medium text-on-error hover:opacity-90 disabled:opacity-50"
                : "min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
            }
          >
            {enviando && (suspender ? "Suspendiendo…" : "Reactivando…")}
            {!enviando &&
              (suspender ? "Suspender establecimiento" : "Reactivar")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
