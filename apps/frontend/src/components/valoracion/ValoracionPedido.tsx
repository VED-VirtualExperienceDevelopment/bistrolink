"use client";

import { useId, useRef, useState } from "react";
import {
  cuerpoValoracion,
  ESTRELLAS,
  ETIQUETAS_ESTRELLAS,
  LARGO_MAXIMO_COMENTARIO,
  nombreEstrella,
  resultadoDelError,
  type Valoracion,
} from "./valoracion.utils";

type Estado = "eligiendo" | "enviando" | "enviada" | "ya-valorada" | "omitida";

const CLASE_TARJETA =
  "bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]";
const CLASE_FOCO =
  "focus:outline-none focus-visible:ring-4 focus-visible:ring-marca/30";
// Estrella llena: ámbar con borde más oscuro (contraste ≥ 3:1 sobre blanco,
// WCAG 1.4.11). Vacía: el gris del texto secundario.
const RELLENO_LLENA = "#D97706";
const BORDE_LLENA = "#B45309";
const BORDE_VACIA = "#79767D";

export function IconoEstrella({
  llena,
  tamano = 28,
}: Readonly<{ llena: boolean; tamano?: number }>) {
  return (
    <svg
      aria-hidden="true"
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill={llena ? RELLENO_LLENA : "none"}
      stroke={llena ? BORDE_LLENA : BORDE_VACIA}
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" />
    </svg>
  );
}

/**
 * HU-050 (BL-558): valoración privada del pedido, en «Gracias por tu
 * compra». De 1 a 5 estrellas y un comentario opcional; se puede omitir.
 *
 * Accesible: las estrellas son un grupo de radios con nombre («4 de 5: Muy
 * bueno»), se eligen con las flechas del teclado y cada una mide 44 × 44 px.
 * El resultado se anuncia con <output> (rol status) y los errores con
 * role="alert".
 */
export function ValoracionPedido({
  onEnviar,
}: Readonly<{ onEnviar: (valoracion: Valoracion) => Promise<void> }>) {
  const id = useId();
  const [estrellas, setEstrellas] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [estado, setEstado] = useState<Estado>("eligiendo");
  const [error, setError] = useState<string | null>(null);
  const grupoRef = useRef<HTMLFieldSetElement>(null);

  async function enviar() {
    if (estrellas === null) {
      setError("Elegí de 1 a 5 estrellas.");
      grupoRef.current?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    setError(null);
    setEstado("enviando");
    try {
      await onEnviar(cuerpoValoracion(estrellas, comentario));
      setEstado("enviada");
    } catch (err) {
      const resultado = resultadoDelError(err);
      if (resultado.tipo === "error") {
        setError(resultado.mensaje);
        setEstado("eligiendo");
      } else {
        setEstado("ya-valorada");
      }
    }
  }

  if (estado === "enviada" || estado === "ya-valorada") {
    return (
      <section
        aria-labelledby={`${id}-titulo`}
        data-testid="valoracion-pedido"
        className={`${CLASE_TARJETA} flex items-start gap-3`}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-50">
          <IconoEstrella llena tamano={22} />
        </span>
        <div>
          <h2 id={`${id}-titulo`} className="text-lg font-bold text-foreground">
            Tu valoración
          </h2>
          <output className="block text-sm text-[#5a575e]">
            {estado === "enviada"
              ? "¡Gracias! Le llegó al local. No se publica."
              : "Ya habías valorado este pedido. ¡Gracias!"}
          </output>
        </div>
      </section>
    );
  }

  if (estado === "omitida") {
    return (
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setEstado("eligiendo")}
          className={`min-h-11 rounded-[0.5rem] px-4 text-sm font-semibold text-marca underline underline-offset-2 hover:bg-marca/10 ${CLASE_FOCO}`}
        >
          Valorar el pedido
        </button>
      </div>
    );
  }

  const enviando = estado === "enviando";
  const mostrada = estrellas ?? 0;

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      data-testid="valoracion-pedido"
      className={CLASE_TARJETA}
    >
      <h2 id={`${id}-titulo`} className="text-lg font-bold text-foreground">
        ¿Cómo estuvo tu pedido?
      </h2>
      <p id={`${id}-ayuda`} className="mt-1 text-sm text-[#5a575e]">
        Tu opinión es privada: solo la ve el local y no guardamos quién sos.
      </p>

      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <fieldset ref={grupoRef} aria-describedby={`${id}-ayuda`}>
          <legend className="sr-only">Estrellas, de 1 a 5</legend>
          <div className="flex flex-wrap items-center gap-1">
            {ESTRELLAS.map((n) => (
              <label
                key={n}
                className="grid h-11 w-11 cursor-pointer place-items-center rounded-full hover:bg-amber-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marca"
              >
                <input
                  type="radio"
                  name={`${id}-estrellas`}
                  value={n}
                  checked={estrellas === n}
                  onChange={() => {
                    setEstrellas(n);
                    setError(null);
                  }}
                  disabled={enviando}
                  aria-label={nombreEstrella(n)}
                  className="sr-only"
                />
                <IconoEstrella llena={n <= mostrada} />
              </label>
            ))}
          </div>
          {/* Lo que significa la elegida. El lector ya lo oye en el nombre
              del radio. */}
          <p
            aria-hidden="true"
            className="mt-1 min-h-5 pl-1 text-sm font-semibold text-foreground"
          >
            {mostrada > 0 ? ETIQUETAS_ESTRELLAS[mostrada - 1] : ""}
          </p>
        </fieldset>

        <div>
          <label
            htmlFor={`${id}-comentario`}
            className="block text-sm font-semibold text-foreground"
          >
            Contanos más <span className="font-normal">(opcional)</span>
          </label>
          <textarea
            id={`${id}-comentario`}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            maxLength={LARGO_MAXIMO_COMENTARIO}
            rows={3}
            disabled={enviando}
            aria-describedby={`${id}-largo`}
            className="mt-1 w-full rounded-[0.5rem] border border-culinary-neutral/40 px-3 py-2 text-sm text-foreground focus:border-marca focus:outline-none focus:ring-4 focus:ring-marca/20"
          />
          <p id={`${id}-largo`} className="mt-1 text-xs text-[#5a575e]">
            {comentario.length}/{LARGO_MAXIMO_COMENTARIO}. No escribas datos
            personales.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[#BA1A1A]">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={enviando}
            className={`min-h-11 rounded-[0.5rem] bg-marca px-5 font-semibold text-white hover:bg-marca-hover disabled:opacity-60 ${CLASE_FOCO}`}
          >
            {enviando ? "Enviando…" : "Enviar valoración"}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEstado("omitida");
            }}
            disabled={enviando}
            className={`min-h-11 rounded-[0.5rem] px-4 font-semibold text-marca hover:bg-marca/10 disabled:opacity-60 ${CLASE_FOCO}`}
          >
            Ahora no
          </button>
        </div>
      </form>
    </section>
  );
}
