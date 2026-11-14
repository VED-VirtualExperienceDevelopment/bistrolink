"use client";

import { forwardRef } from "react";
import { resumenMisPedidos, type PedidoDeLaMesa } from "./mis-pedidos.utils";

interface Props {
  readonly pedidos: readonly PedidoDeLaMesa[];
  /** «barra»: fija abajo en el celular. «nav»: en la barra superior. */
  readonly variante: "barra" | "nav";
  readonly onAbrir: () => void;
}

function IconoTicket() {
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
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2z" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  );
}

/**
 * BL-502: acceso a «Mis pedidos». En la barra, dos líneas fijas (el título
 * con la cantidad y el estado más importante); el texto no se parte: si no
 * entra, se corta con «…». El ícono y la flecha no se achican.
 */
export const MisPedidosBoton = forwardRef<HTMLButtonElement, Props>(
  function MisPedidosBoton({ pedidos, variante, onAbrir }, ref) {
    const cantidad = pedidos.length;
    const resumen = resumenMisPedidos(pedidos);
    const etiqueta = `Mis pedidos: ${cantidad}. ${resumen}`;

    if (variante === "nav") {
      return (
        <button
          ref={ref}
          type="button"
          onClick={onAbrir}
          aria-label={etiqueta}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-marca/30 bg-marca/10 px-3 py-1.5 text-sm font-semibold text-marca hover:bg-marca/15 focus:outline-none focus:ring-4 focus:ring-marca/30"
        >
          <IconoTicket />
          <span className="hidden sm:inline">Mis pedidos</span>
          <span className="grid min-w-6 h-6 place-items-center rounded-full bg-white px-1.5 text-xs font-bold">
            {cantidad}
          </span>
        </button>
      );
    }

    return (
      <button
        ref={ref}
        type="button"
        onClick={onAbrir}
        aria-label={etiqueta}
        aria-haspopup="dialog"
        data-testid="mis-pedidos-barra"
        className="flex w-full items-center gap-3 rounded-[0.75rem] border border-marca/30 bg-culinary-primary-container px-4 py-3 text-left text-marca shadow-[0px_4px_20px_rgba(121,118,125,0.15)] focus:outline-none focus:ring-4 focus:ring-marca/30"
      >
        <IconoTicket />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-bold">Mis pedidos</span>
            <span className="grid min-w-6 h-6 place-items-center rounded-full bg-white px-1.5 text-xs font-bold">
              {cantidad}
            </span>
          </span>
          <span className="block truncate text-xs">{resumen}</span>
        </span>
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    );
  },
);
