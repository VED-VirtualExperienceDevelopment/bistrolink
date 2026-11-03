"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { errorDeRut, normalizarRut } from "@/lib/rut";
import {
  mensajeAnonimizacion,
  RUTA_ANONIMIZAR_RECEPTOR,
  type ResultadoAnonimizacion,
} from "./configuracion.utils";

const CLASE_CONTROL =
  "min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-error";
const CLASE_BOTON_SECUNDARIO =
  "min-h-12 rounded-lg border border-outline-variant px-4 text-body-md text-primary hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";
const CLASE_BOTON_PELIGRO =
  "min-h-12 rounded-lg bg-error px-4 text-body-md font-medium text-on-error hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error disabled:cursor-not-allowed disabled:opacity-50";

/**
 * HU-009 (BL-453): pedido de supresión de un comensal que pidió e-Factura
 * (Ley 18.331). El administrador ingresa el RUT y, después de confirmar, se
 * borran el RUT y la razón social de los pedidos del local con ese RUT. Las
 * e-Facturas emitidas y los montos no cambian. Queda en la auditoría (sin
 * el RUT).
 *
 * Formulario propio, fuera del de la configuración: no se guarda con
 * «Guardar cambios».
 */
export default function AnonimizarDatosFactura({
  token,
}: {
  readonly token: string;
}) {
  const [rut, setRut] = useState("");
  const [intentado, setIntentado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState("");
  const [error, setError] = useState<string | null>(null);

  const errorRut = errorDeRut(rut);
  const mostrarError = intentado && Boolean(errorRut);

  function pedirConfirmacion(e: React.FormEvent) {
    e.preventDefault();
    setIntentado(true);
    setResultado("");
    setError(null);
    if (errorRut) return;
    setConfirmando(true);
  }

  async function anonimizar() {
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await apiFetch<ResultadoAnonimizacion>(
        RUTA_ANONIMIZAR_RECEPTOR,
        token,
        {
          method: "POST",
          body: JSON.stringify({ rut: normalizarRut(rut) }),
        },
      );
      setResultado(mensajeAnonimizacion(respuesta));
      setRut("");
      setIntentado(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudieron anonimizar los datos. Probá de nuevo.",
      );
    } finally {
      setEnviando(false);
      setConfirmando(false);
    }
  }

  return (
    <section
      aria-labelledby="titulo-anonimizar"
      className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 md:p-6"
    >
      <h2 id="titulo-anonimizar" className="text-headline-sm text-on-surface">
        Anonimizar datos de facturación
      </h2>
      <p className="text-body-sm text-on-surface-variant">
        Si un comensal que pidió e-Factura te pide eliminar sus datos, ingresá
        su RUT: se borran el RUT y la razón social de sus pedidos. Las
        e-Facturas ya emitidas y los montos no cambian (se conservan 5 años por
        obligación fiscal).
      </p>
      <form onSubmit={pedirConfirmacion} noValidate className="space-y-3">
        <div>
          <label
            htmlFor="anonimizar-rut"
            className="mb-1 block text-label-md text-on-surface-variant"
          >
            RUT del comensal
          </label>
          <input
            id="anonimizar-rut"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            value={rut}
            disabled={enviando || confirmando}
            onChange={(e) => {
              setRut(e.target.value);
              setResultado("");
            }}
            aria-invalid={mostrarError}
            aria-describedby={mostrarError ? "anonimizar-rut-error" : undefined}
            className={CLASE_CONTROL}
          />
          {mostrarError && (
            <p
              id="anonimizar-rut-error"
              className="mt-1 text-body-sm text-error"
            >
              {errorRut}
            </p>
          )}
        </div>

        {confirmando ? (
          <div
            role="alertdialog"
            aria-labelledby="anonimizar-confirmar"
            className="space-y-3 rounded-lg bg-error-container p-3"
          >
            <p
              id="anonimizar-confirmar"
              className="text-body-md text-on-error-container"
            >
              ¿Anonimizar los datos de este RUT? No se puede deshacer.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void anonimizar()}
                disabled={enviando}
                className={CLASE_BOTON_PELIGRO}
              >
                {enviando ? "Anonimizando…" : "Sí, anonimizar"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                disabled={enviando}
                className={CLASE_BOTON_SECUNDARIO}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button type="submit" className={CLASE_BOTON_SECUNDARIO}>
            Anonimizar
          </button>
        )}
      </form>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {error}
        </p>
      )}
      <p
        className="text-body-md text-on-surface-variant"
        aria-live="polite"
        aria-atomic="true"
      >
        {resultado}
      </p>
    </section>
  );
}
