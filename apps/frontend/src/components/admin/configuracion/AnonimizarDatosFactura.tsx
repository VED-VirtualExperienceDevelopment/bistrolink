"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { errorDeRut, normalizarRut } from "@/lib/rut";
import { normalizarContactoRetiro } from "@/components/retiro/retiro.utils";
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
  mensajeAnonimizacionRetiro,
  RUTA_ANONIMIZAR_RECEPTOR,
  RUTA_ANONIMIZAR_RETIRO,
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
  return (
    <FormularioAnonimizar
      token={token}
      id="anonimizar"
      titulo="Anonimizar datos de facturación"
      ayuda="Si un comensal que pidió e-Factura te pide eliminar sus datos, ingresá su RUT: se borran el RUT y la razón social de sus pedidos. Las e-Facturas ya emitidas y los montos no cambian (se conservan 5 años por obligación fiscal)."
      etiqueta="RUT del comensal"
      inputMode="numeric"
      largoMaximo={20}
      confirmacion="¿Anonimizar los datos de este RUT? No se puede deshacer."
      ruta={RUTA_ANONIMIZAR_RECEPTOR}
      validar={errorDeRut}
      cuerpo={(valor) => ({ rut: normalizarRut(valor) })}
      mensaje={mensajeAnonimizacion}
    />
  );
}

/**
 * HU-040 (BL-210): lo mismo para el nombre y el contacto (teléfono o correo)
 * que dejó un comensal en un pedido para retirar. El pedido, los montos y el
 * comprobante no cambian.
 */
export function AnonimizarContactoRetiro({
  token,
}: {
  readonly token: string;
}) {
  return (
    <FormularioAnonimizar
      token={token}
      id="anonimizar-retiro"
      titulo="Anonimizar datos de pedidos para retirar"
      ayuda="Si un comensal te pide eliminar el nombre y el contacto que dejó en un pedido para retirar, ingresá ese teléfono o correo: se borran de todos sus pedidos. Los pedidos, los montos y los comprobantes no cambian."
      etiqueta="Teléfono o correo del comensal"
      largoMaximo={100}
      confirmacion="¿Anonimizar los datos de este contacto? No se puede deshacer."
      ruta={RUTA_ANONIMIZAR_RETIRO}
      validar={(valor) =>
        normalizarContactoRetiro(valor).length < 3
          ? "Escribí el teléfono o el correo que dejó el comensal."
          : null
      }
      cuerpo={(valor) => ({ contacto: valor.trim() })}
      mensaje={mensajeAnonimizacionRetiro}
    />
  );
}

interface FormularioAnonimizarProps {
  readonly token: string;
  /** Prefijo de los ids del formulario. */
  readonly id: string;
  readonly titulo: string;
  readonly ayuda: string;
  readonly etiqueta: string;
  readonly inputMode?: "numeric" | "text";
  readonly largoMaximo: number;
  readonly confirmacion: string;
  readonly ruta: string;
  /** Error del dato, o null si está bien. */
  readonly validar: (valor: string) => string | null | undefined;
  readonly cuerpo: (valor: string) => Record<string, string>;
  readonly mensaje: (resultado: ResultadoAnonimizacion) => string;
}

/**
 * Formulario de anonimización (HU-009 y HU-040): un dato, confirmación y
 * resultado. Formulario propio, fuera del de la configuración.
 */
function FormularioAnonimizar({
  token,
  id,
  titulo,
  ayuda,
  etiqueta,
  inputMode = "text",
  largoMaximo,
  confirmacion,
  ruta,
  validar,
  cuerpo,
  mensaje,
}: FormularioAnonimizarProps) {
  const [valor, setValor] = useState("");
  const [intentado, setIntentado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState("");
  const [error, setError] = useState<string | null>(null);

  const errorDato = validar(valor);
  const mostrarError = intentado && Boolean(errorDato);

  function pedirConfirmacion(e: React.FormEvent) {
    e.preventDefault();
    setIntentado(true);
    setResultado("");
    setError(null);
    if (errorDato) return;
    setConfirmando(true);
  }

  async function anonimizar() {
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await apiFetch<ResultadoAnonimizacion>(ruta, token, {
        method: "POST",
        body: JSON.stringify(cuerpo(valor)),
      });
      setResultado(mensaje(respuesta));
      setValor("");
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
    <section aria-labelledby={`titulo-${id}`} className={CLASE_TARJETA}>
      <h2 id={`titulo-${id}`} className={CLASE_TITULO_TARJETA}>
        {titulo}
      </h2>
      <p className={CLASE_AYUDA}>{ayuda}</p>
      <form onSubmit={pedirConfirmacion} noValidate className="space-y-3">
        <div>
          <label htmlFor={`${id}-dato`} className={CLASE_ETIQUETA}>
            {etiqueta}
          </label>
          <input
            id={`${id}-dato`}
            type="text"
            inputMode={inputMode}
            autoComplete="off"
            maxLength={largoMaximo}
            value={valor}
            disabled={enviando || confirmando}
            onChange={(e) => {
              setValor(e.target.value);
              setResultado("");
            }}
            aria-invalid={mostrarError}
            aria-describedby={mostrarError ? `${id}-error` : undefined}
            className={CLASE_CONTROL}
          />
          {mostrarError && (
            <p id={`${id}-error`} className={CLASE_ERROR_CAMPO}>
              {errorDato}
            </p>
          )}
        </div>

        {confirmando ? (
          <div
            role="alertdialog"
            aria-labelledby={`${id}-confirmar`}
            className="space-y-3 rounded-lg bg-error-container p-3"
          >
            <p
              id={`${id}-confirmar`}
              className="text-body-md text-on-error-container"
            >
              {confirmacion}
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
