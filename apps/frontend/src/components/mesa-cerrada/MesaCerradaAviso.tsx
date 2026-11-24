"use client";

import { useEffect, useRef } from "react";
import { etiquetaMesa } from "@/components/menu-digital.utils";
import { DETALLE_MESA_CERRADA, TITULO_MESA_CERRADA } from "./sesion-mesa.utils";

interface Props {
  readonly nombreLocal?: string;
  readonly numeroMesa?: number;
}

/**
 * BL-518: reemplaza la carta cuando el mozo cierra la mesa. El título toma
 * el foco para que el lector de pantalla anuncie el cambio.
 */
export function MesaCerradaAviso({ nombreLocal, numeroMesa }: Props) {
  const tituloRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  const lugar = [nombreLocal, etiquetaMesa(numeroMesa)]
    .filter(Boolean)
    .join(" · ");

  return (
    <main
      data-testid="mesa-cerrada"
      className="flex min-h-screen items-center justify-center bg-culinary-background p-8"
    >
      <div className="max-w-md rounded-[1rem] border border-culinary-neutral/10 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 text-4xl" aria-hidden="true">
          🪑
        </div>
        <h1
          ref={tituloRef}
          tabIndex={-1}
          className="text-lg font-semibold text-foreground outline-none"
        >
          {TITULO_MESA_CERRADA}
        </h1>
        {lugar && <p className="mt-1 text-sm text-[#5a575e]">{lugar}</p>}
        <p className="mt-3 text-sm text-[#5a575e]">{DETALLE_MESA_CERRADA}</p>
      </div>
    </main>
  );
}
