"use client";

import type { ReactNode } from "react";
import { formatearPrecio } from "@/components/pago/pago.utils";
import { ID_TITULO_CARRITO } from "./carrito.utils";

export type LineaCarrito = {
  readonly itemCartaId: string;
  readonly nombre: string;
  readonly precio: number;
  readonly cantidad: number;
  readonly observacion?: string;
};

interface Props<T extends LineaCarrito> {
  /** «columna»: a la derecha desde lg. «hoja»: dentro de CarritoHoja. */
  readonly variante: "columna" | "hoja";
  readonly lineas: readonly T[];
  readonly cantidadTotal: number;
  readonly total: number;
  readonly observacionGeneral: string;
  readonly maxCaracteresGeneral: number;
  readonly onCambiarObservacion: (texto: string) => void;
  readonly onEditarNota: (linea: T) => void;
  readonly onVaciar: () => void;
  readonly onContinuar: () => void;
  readonly enviando: boolean;
  readonly error: string | null;
  /** Solo en la hoja: la X de arriba y «Seguir viendo la carta». */
  readonly onCerrar?: () => void;
  /** HU-040 (BL-210): «Continuar al pago» deshabilitado (retiro cerrado). */
  readonly pagoBloqueado?: boolean;
  /** HU-040 (BL-210): datos del comensal del retiro, después de las instrucciones. */
  readonly contacto?: ReactNode;
}

const UMBRAL_AVISO = 0.9;

function clasesInstrucciones(
  cantidad: number,
  maximo: number,
): {
  borde: string;
  contador: string;
} {
  if (cantidad > maximo) {
    return {
      borde:
        "border-2 border-[#BA1A1A] bg-[#FFDAD6] focus:border-[#BA1A1A] focus:ring-2 focus:ring-[#BA1A1A]/20",
      contador: "text-[#BA1A1A]",
    };
  }
  if (cantidad >= maximo * UMBRAL_AVISO) {
    return {
      borde:
        "border-2 border-[#755b00] bg-culinary-background focus:border-[#755b00] focus:ring-2 focus:ring-[#755b00]/20",
      contador: "text-[#755b00]",
    };
  }
  return {
    borde:
      "border-2 border-culinary-neutral/30 bg-culinary-background focus:border-[#6e54ad] focus:ring-2 focus:ring-[#6e54ad]/20",
    contador: "text-[#5a575e]",
  };
}

function IconoCerrar() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function IconoLapiz() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

/**
 * El contenido del carrito: platos con su nota, instrucciones generales,
 * total y «Continuar al pago». BL-519: el mismo contenido va en la columna
 * de la derecha (desde lg) o en la hoja del celular; se muestra uno solo a
 * la vez, así los ids y los botones no se repiten.
 */
export function CarritoDetalle<T extends LineaCarrito>({
  variante,
  lineas,
  cantidadTotal,
  total,
  observacionGeneral,
  maxCaracteresGeneral,
  onCambiarObservacion,
  onEditarNota,
  onVaciar,
  onContinuar,
  enviando,
  error,
  onCerrar,
  pagoBloqueado = false,
  contacto = null,
}: Props<T>) {
  const enHoja = variante === "hoja";
  const caracteres = observacionGeneral.length;
  const pasado = caracteres > maxCaracteresGeneral;
  const clases = clasesInstrucciones(caracteres, maxCaracteresGeneral);
  const Titulo = enHoja ? "h2" : "h3";

  const encabezado = (
    <div className="flex items-center justify-between gap-2">
      <Titulo
        id={ID_TITULO_CARRITO}
        className="font-bold text-lg text-foreground flex items-center gap-2"
      >
        <span role="img" aria-label="Carrito">
          🛒
        </span>{" "}
        Tu pedido ({cantidadTotal} {cantidadTotal === 1 ? "item" : "items"})
      </Titulo>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onVaciar}
          className="text-sm text-red-600 hover:text-red-700 font-medium px-2 py-1 bg-red-50 rounded-md transition-colors"
          disabled={enviando}
        >
          Vaciar
        </button>
        {onCerrar && (
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar el pedido"
            data-foco-inicial
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground hover:bg-culinary-neutral/10 focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30"
          >
            <IconoCerrar />
          </button>
        )}
      </div>
    </div>
  );

  const platos = (
    <ul
      className={`space-y-3 ${enHoja ? "" : "max-h-60 overflow-y-auto pr-1"}`}
    >
      {lineas.map((linea) => (
        <li
          key={linea.itemCartaId}
          className="flex flex-col bg-culinary-background p-3 rounded-lg"
        >
          <div className="flex items-start justify-between text-sm">
            <div className="flex-1 pr-2">
              <span className="font-semibold text-foreground">
                {linea.cantidad}x {linea.nombre}
              </span>
              <button
                type="button"
                onClick={() => onEditarNota(linea)}
                className="text-xs text-[#6e54ad] mt-1.5 flex items-center gap-1 hover:underline font-medium"
              >
                <IconoLapiz />
                Editar nota
              </button>
              {linea.observacion && (
                <p className="text-xs text-[#5a575e] mt-1 italic line-clamp-2">
                  &quot;{linea.observacion}&quot;
                </p>
              )}
            </div>
            <span className="font-semibold text-foreground">
              {formatearPrecio(linea.precio * linea.cantidad)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );

  const instrucciones = (
    <div className="border-t border-culinary-neutral/15 pt-4">
      <label
        htmlFor="observacion-general"
        className="text-sm font-semibold text-foreground mb-2 block"
      >
        Instrucciones generales
      </label>
      <textarea
        id="observacion-general"
        value={observacionGeneral}
        onChange={(e) => onCambiarObservacion(e.target.value)}
        placeholder="Ej: Ningún plato debe llevar maní."
        className={`w-full p-3 rounded-lg text-sm resize-none outline-none transition-all duration-200 placeholder:text-[#5a575e]/70 ${clases.borde}`}
        maxLength={maxCaracteresGeneral + 20}
        rows={2}
      />
      <div className="flex justify-end mt-1">
        <span className={`text-xs font-semibold ${clases.contador}`}>
          {caracteres}/{maxCaracteresGeneral}
        </span>
      </div>
    </div>
  );

  const pie = (
    <>
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm font-medium mb-4 flex items-start gap-2">
          <span>⚠️</span> {error}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <span className="font-bold text-foreground text-lg">Total:</span>
        <span className="text-2xl font-bold text-[#6e54ad]">
          {formatearPrecio(total)}
        </span>
      </div>
      <button
        type="button"
        onClick={onContinuar}
        disabled={enviando || pasado || pagoBloqueado}
        className="w-full px-4 py-3.5 bg-[#6e54ad] text-white font-bold rounded-[0.5rem] hover:bg-[#5b468f] focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg shadow-[0px_4px_20px_rgba(121,118,125,0.15)]"
      >
        {enviando ? "Preparando tu pedido…" : "Continuar al pago"}
      </button>
    </>
  );

  if (!enHoja) {
    return (
      <>
        <div className="mb-4">{encabezado}</div>
        <div className="mb-4">{platos}</div>
        <div className="mb-4">{instrucciones}</div>
        {contacto}
        <div className="pt-2">{pie}</div>
      </>
    );
  }

  // En la hoja: el encabezado y el pie quedan fijos y lo del medio se
  // desplaza (también con el teclado abierto en las instrucciones).
  return (
    <>
      <div className="border-b border-culinary-neutral/15 px-5 pb-3 pt-2">
        <div
          aria-hidden="true"
          className="mx-auto mb-2 h-1 w-10 rounded-full bg-culinary-neutral/30"
        />
        {encabezado}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
        {platos}
        {instrucciones}
        {contacto}
      </div>
      <div className="border-t border-culinary-neutral/15 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {pie}
        <button
          type="button"
          onClick={onCerrar}
          className="mt-2 w-full rounded-[0.5rem] py-2.5 text-sm font-semibold text-[#6e54ad] hover:bg-[#6e54ad]/10 focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30"
        >
          Seguir viendo la carta
        </button>
      </div>
    </>
  );
}
