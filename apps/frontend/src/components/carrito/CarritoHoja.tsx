"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ID_TITULO_CARRITO } from "./carrito.utils";

interface Props {
  readonly abierto: boolean;
  readonly onCerrar: () => void;
  readonly children: ReactNode;
}

/**
 * BL-519: el detalle del carrito en el celular, en una hoja que sube desde
 * abajo. <dialog> nativo, igual que «Mis pedidos» (BL-502): atrapa el foco y
 * cierra con Escape. También cierra al tocar la parte oscura de arriba. Al
 * cerrar, el foco vuelve a la barra del carrito.
 */
export function CarritoHoja({ abierto, onCerrar, children }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    if (abierto && !el.open) {
      focoAnterior.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      el.showModal();
      // El foco va al botón de cerrar, no al fondo que también cierra.
      el.querySelector<HTMLElement>("[data-foco-inicial]")?.focus();
    }
    if (!abierto && el.open) el.close();
  }, [abierto]);

  const alCerrar = () => {
    focoAnterior.current?.focus();
    focoAnterior.current = null;
    onCerrar();
  };

  return (
    <dialog
      ref={dialogo}
      onClose={alCerrar}
      aria-labelledby={ID_TITULO_CARRITO}
      data-testid="carrito-hoja"
      className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/40"
    >
      <div className="flex h-full flex-col">
        {/* La parte oscura de arriba: tocarla cierra la hoja. Fuera del orden
        del tabulador: con teclado se cierra con Escape o con los botones. */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Cerrar"
          onClick={onCerrar}
          className="min-h-[15dvh] flex-1 cursor-default"
        />
        <div className="flex max-h-[85dvh] flex-col rounded-t-[1.25rem] bg-white shadow-[0px_-4px_20px_rgba(121,118,125,0.15)]">
          {children}
        </div>
      </div>
    </dialog>
  );
}
