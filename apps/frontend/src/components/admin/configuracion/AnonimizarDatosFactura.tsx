"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { errorDeRut, normalizarRut } from "@/lib/rut";
import {
  CLASE_AYUDA,
  CLASE_BOTON_PELIGRO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  CLASE_ERROR_CAMPO,
  CLASE_ERROR_GENERAL,
  CLASE_ETIQUETA,
  CLASE_TARJETA,
  CLASE_TITULO_TARJETA,
} from "./configuracion.estilos";
import {
  mensajeAnonimizacion,
  RUTA_ANONIMIZAR_RECEPTOR,
  type ResultadoAnonimizacion,
} from "./configuracion.utils";

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
    <section aria-labelledby="titulo-anonimizar" className={CLASE_TARJETA}>
      <h2 id="titulo-anonimizar" className={CLASE_TITULO_TARJETA}>
        Anonimizar datos de facturación
      </h2>
      <p className={CLASE_AYUDA}>
        Si un comensal que pidió e-Factura te pide eliminar sus datos, ingresá
        su RUT: se borran el RUT y la razón social de sus pedidos. Las
        e-Facturas ya emitidas y los montos no cambian (se conservan 5 años por
        obligación fiscal).
      </p>
      <form onSubmit={pedirConfirmacion} noValidate className="space-y-3">
        <div>
          <label htmlFor="anonimizar-rut" className={CLASE_ETIQUETA}>
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
            <p id="anonimizar-rut-error" className={CLASE_ERROR_CAMPO}>
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
          <button
            type="submit"
            className={`${CLASE_BOTON_SECUNDARIO} w-full sm:w-auto`}
          >
            Anonimizar
          </button>
        )}
      </form>

      {error && (
        <p role="alert" className={CLASE_ERROR_GENERAL}>
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
