"use client";

import { formatearPrecio } from "@/components/pago/pago.utils";
import { textoItems } from "./carrito.utils";

interface Props {
  readonly cantidad: number;
  readonly total: number;
  readonly onAbrir: () => void;
}

/**
 * BL-519: el carrito en el celular. Una sola línea fija abajo (cantidad,
 * «Ver pedido» y total) para que la carta quede a la vista; el detalle se
 * abre en una hoja (CarritoHoja).
 */
export function CarritoBarra({ cantidad, total, onAbrir }: Props) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-haspopup="dialog"
      data-testid="carrito-barra"
      className="flex w-full items-center gap-3 rounded-[0.75rem] bg-[#6e54ad] px-4 py-3.5 text-white shadow-[0px_4px_20px_rgba(121,118,125,0.3)] transition-colors hover:bg-[#5b468f] focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30"
    >
      <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-full bg-white px-2 text-sm font-bold text-[#6e54ad]">
        <span aria-hidden="true">{cantidad}</span>
        <span className="sr-only">{textoItems(cantidad)} en el pedido.</span>
      </span>
      <span className="flex-1 whitespace-nowrap text-left font-bold">
        Ver pedido
      </span>
      <span className="whitespace-nowrap font-bold">
        {formatearPrecio(total)}
      </span>
    </button>
  );
}
