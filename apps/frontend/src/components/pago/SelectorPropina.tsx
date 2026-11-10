"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatearPrecio } from "./pago.utils";
import {
  SIN_PROPINA,
  errorMontoPropina,
  etiquetaDePropina,
  evaluarMontoPropina,
  mismaEleccion,
  montoDePropina,
  opcionesDePropina,
  topeDePropina,
  totalConPropina,
  type EleccionPropina,
} from "./propina.utils";

const CLASE_OPCION =
  "relative min-h-16 rounded-xl border px-2 py-2 flex flex-col items-center justify-center gap-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6e54ad]/40 disabled:opacity-50 disabled:cursor-not-allowed";
const CLASE_OPCION_ACTIVA = "border-2 border-[#6e54ad] bg-[#6e54ad]/10";
const CLASE_OPCION_INACTIVA =
  "border-culinary-neutral/30 bg-white hover:border-[#6e54ad]";

const CLASE_BOTON_SECUNDARIO =
  "min-h-12 rounded-xl border px-3 text-[0.9375rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6e54ad]/40 disabled:opacity-50 disabled:cursor-not-allowed";

/** Una columna por tarjeta hasta 3; con más porcentajes, 3 por fila. */
function claseColumnas(cantidad: number): string {
  if (cantidad <= 1) return "grid-cols-1";
  if (cantidad === 2) return "grid-cols-2";
  return "grid-cols-3";
}

/**
 * HU-022 (BL-495): el comensal elige la propina antes de pagar.
 *
 * - Una tarjeta por porcentaje que sugiere el local (HU-020), con su monto en
 *   pesos, más «Otro monto» (pesos enteros hasta el consumo) y «Sin propina».
 * - Es una elección voluntaria: sin tocar nada no hay propina y se puede
 *   pagar igual.
 * - `sugerida`: el local preseleccionó el 10 % y el comensal todavía no
 *   tocó nada. Se marca con la etiqueta «Sugerida»; el padre la apaga en
 *   cuanto llega cualquier elección.
 * - `deshabilitado`: mientras se guarda o se paga. Con `nota` se le explica
 *   por qué no se puede cambiar.
 *
 * Los montos se calculan acá solo para mostrarlos (propina.utils.ts, mismo
 * redondeo que el backend); el backend los vuelve a calcular al cobrar.
 */
export function SelectorPropina({
  consumo,
  sugeridas,
  eleccion,
  sugerida,
  onElegir,
  deshabilitado,
  nota,
}: {
  /** Consumo con IVA incluido, sin propina. */
  readonly consumo: number | string;
  /** Porcentajes sugeridos por el local, de menor a mayor. */
  readonly sugeridas: readonly number[];
  readonly eleccion: EleccionPropina;
  readonly sugerida: boolean;
  readonly onElegir: (eleccion: EleccionPropina) => void;
  readonly deshabilitado: boolean;
  readonly nota?: string;
}) {
  const idTitulo = useId();
  const idPanel = useId();
  const idInput = useId();
  const idAyuda = useId();
  const idError = useId();
  const refInput = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");

  // Al abrir «Otro monto», el foco va al campo.
  useEffect(() => {
    if (abierto) refInput.current?.focus();
  }, [abierto]);

  const opciones = opcionesDePropina(consumo, sugeridas);
  const montoPropina = montoDePropina(consumo, eleccion);
  const total = totalConPropina(consumo, eleccion);
  const estadoMonto = evaluarMontoPropina(texto, consumo);
  const error = errorMontoPropina(estadoMonto);
  const tope = topeDePropina(consumo);
  const conMontoLibre = eleccion.tipo === "monto";

  function elegir(nueva: EleccionPropina) {
    setAbierto(false);
    onElegir(nueva);
  }

  function alternarOtroMonto() {
    if (!abierto && eleccion.tipo === "monto" && texto === "") {
      setTexto(String(eleccion.monto));
    }
    setAbierto((v) => !v);
  }

  function aplicarMonto() {
    if (estadoMonto.tipo !== "ok") return;
    elegir({ tipo: "monto", monto: estadoMonto.monto });
  }

  return (
    <section
      aria-labelledby={idTitulo}
      className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)] flex flex-col gap-4"
    >
      <div>
        <h2 id={idTitulo} className="text-lg font-bold text-foreground">
          ¿Querés dejar propina?
        </h2>
        <p className="text-sm text-[#5a575e]">
          {sugerida
            ? "Sugerida por el local. Es voluntaria: tocá «Sin propina» para quitarla."
            : "Es voluntaria. Podés cambiarla antes de pagar."}
        </p>
      </div>

      {opciones.length > 0 && (
        <div className={`grid gap-2 ${claseColumnas(opciones.length)}`}>
          {opciones.map(({ porcentaje, monto }) => {
            const opcion: EleccionPropina = { tipo: "porcentaje", porcentaje };
            const activa = mismaEleccion(eleccion, opcion);
            return (
              <button
                key={porcentaje}
                type="button"
                aria-pressed={activa}
                disabled={deshabilitado}
                onClick={() => elegir(opcion)}
                className={`${CLASE_OPCION} ${activa ? CLASE_OPCION_ACTIVA : CLASE_OPCION_INACTIVA}`}
              >
                {activa && sugerida && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#4a3585] px-2 text-xs font-semibold text-white">
                    Sugerida
                  </span>
                )}
                <span
                  className={`text-lg font-bold ${activa ? "text-[#4a3585]" : "text-foreground"}`}
                >
                  {porcentaje} %
                  {activa && <span aria-hidden="true"> ✓</span>}
                </span>
                <span
                  className={`text-sm ${activa ? "text-[#4a3585]" : "text-[#5a575e]"}`}
                >
                  {formatearPrecio(monto)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={conMontoLibre}
          aria-expanded={abierto}
          aria-controls={idPanel}
          disabled={deshabilitado}
          onClick={alternarOtroMonto}
          className={`${CLASE_BOTON_SECUNDARIO} ${
            conMontoLibre
              ? `${CLASE_OPCION_ACTIVA} text-[#4a3585]`
              : "border-culinary-neutral/30 bg-white text-[#6e54ad] hover:border-[#6e54ad]"
          }`}
        >
          {conMontoLibre && !abierto
            ? `Otro monto · ${formatearPrecio(montoPropina)} ✓`
            : "Otro monto"}
        </button>
        <button
          type="button"
          aria-pressed={eleccion.tipo === "ninguna"}
          disabled={deshabilitado}
          onClick={() => {
            setTexto("");
            elegir(SIN_PROPINA);
          }}
          className={`${CLASE_BOTON_SECUNDARIO} ${
            eleccion.tipo === "ninguna"
              ? `${CLASE_OPCION_ACTIVA} text-[#4a3585]`
              : "border-culinary-neutral/30 bg-white text-foreground hover:border-[#6e54ad]"
          }`}
        >
          Sin propina
        </button>
      </div>

      <div id={idPanel} hidden={!abierto} className="flex flex-col gap-2">
        {abierto && (
          <>
            <label
              htmlFor={idInput}
              className="text-sm font-medium text-foreground"
            >
              Monto de la propina (en pesos)
            </label>
            <div className="flex gap-2">
              <input
                id={idInput}
                ref={refInput}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                value={texto}
                disabled={deshabilitado}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    aplicarMonto();
                  }
                }}
                aria-invalid={error !== null}
                aria-describedby={error ? `${idAyuda} ${idError}` : idAyuda}
                className={`w-full h-12 px-3 rounded-lg border bg-white text-foreground focus:outline-none transition-colors ${
                  error
                    ? "border-[#BA1A1A] bg-[#FFDAD6]/40"
                    : "border-culinary-neutral/30 focus:border-[#6e54ad] focus:ring-2 focus:ring-[#6e54ad]/20"
                }`}
              />
              <button
                type="button"
                onClick={aplicarMonto}
                disabled={deshabilitado || estadoMonto.tipo !== "ok"}
                className="min-h-12 shrink-0 rounded-xl bg-[#6e54ad] px-5 font-semibold text-white transition-colors hover:bg-[#5d4594] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Aplicar
              </button>
            </div>
            <p id={idAyuda} className="text-xs text-[#5a575e]">
              Desde {formatearPrecio(1)} hasta {formatearPrecio(tope)}, sin
              centavos.
            </p>
            {error && (
              <p
                id={idError}
                role="alert"
                className="text-xs font-semibold text-[#BA1A1A]"
              >
                {error}
              </p>
            )}
          </>
        )}
      </div>

      {nota && <p className="text-xs text-[#5a575e]">{nota}</p>}

      <dl
        aria-live="polite"
        className="flex flex-col gap-1.5 border-t border-culinary-neutral/15 pt-3 text-[0.9375rem]"
      >
        <div className="flex justify-between gap-3">
          <dt className="text-[#5a575e]">Consumo</dt>
          <dd>{formatearPrecio(consumo)}</dd>
        </div>
        {eleccion.tipo !== "ninguna" && (
          <div className="flex justify-between gap-3">
            <dt className="text-[#5a575e]">{etiquetaDePropina(eleccion)}</dt>
            <dd>{formatearPrecio(montoPropina)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 text-[1.0625rem] font-bold">
          <dt>Total</dt>
          <dd>{formatearPrecio(total)}</dd>
        </div>
      </dl>
    </section>
  );
}
