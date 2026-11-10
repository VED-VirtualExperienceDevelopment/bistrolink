"use client";

import { useEffect, useRef } from "react";
import { etiquetaMesa } from "@/components/menu-digital.utils";
import { horaCorta } from "@/components/mis-pedidos/mis-pedidos.utils";
import type { LineaResumen } from "./PagoPedido";
import { codigoPedido, formatearPrecio } from "./pago.utils";
import {
  eleccionGuardada,
  etiquetaDePropina,
  type TotalesDelPedido,
} from "./propina.utils";

interface Props {
  readonly pedidoId: string;
  readonly nombreLocal?: string;
  readonly esMesa: boolean;
  readonly numeroMesa?: number;
  /** Hora de la entrega (ISO), si llegó con el evento. */
  readonly entregadoEn: string | null;
  readonly lineas: readonly LineaResumen[];
  /** Consumo, propina y total del backend (null si no los informa). */
  readonly totales: TotalesDelPedido | null;
  /** Lo abonado (null mientras no se sabe). */
  readonly abonado: number | null;
  readonly comprobanteDisponible: boolean;
  readonly descargando: boolean;
  readonly errorDescarga: boolean;
  readonly onDescargarPdf: () => void;
  readonly onOtroPedido: () => void;
  /** BL-502: otros pedidos de la mesa que todavía no llegaron. */
  readonly pedidosEnCamino?: number;
  readonly onVerMisPedidos?: () => void;
}

const CLASE_TARJETA =
  "bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]";

function textoEnCamino(cantidad: number): string {
  return cantidad === 1
    ? "Ver mis pedidos (1 en camino)"
    : `Ver mis pedidos (${cantidad} en camino)`;
}

/**
 * BL-502: «Gracias por tu compra», cuando el pedido pasa a Entregado. Como
 * en otras apps de pedido en la mesa: la confirmación arriba, el detalle de
 * lo que se pagó con el comprobante, y las acciones para seguir (pedir algo
 * más y, si hay, los otros pedidos en camino). Desde lg, en dos columnas.
 */
export function GraciasPorTuCompra({
  pedidoId,
  nombreLocal,
  esMesa,
  numeroMesa,
  entregadoEn,
  lineas,
  totales,
  abonado,
  comprobanteDisponible,
  descargando,
  errorDescarga,
  onDescargarPdf,
  onOtroPedido,
  pedidosEnCamino = 0,
  onVerMisPedidos,
}: Props) {
  const tituloRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  const lugar = [
    nombreLocal,
    esMesa ? etiquetaMesa(numeroMesa) : "Para retirar",
  ]
    .filter(Boolean)
    .join(" · ");
  const hora = entregadoEn ? horaCorta(entregadoEn) : "";
  const conPropina = totales !== null && Number(totales.propina) > 0;

  return (
    <div
      data-testid="gracias-por-tu-compra"
      className="pt-20 pb-12 px-4 md:px-8 max-w-[720px] mx-auto flex flex-col gap-6"
    >
      <section className={`${CLASE_TARJETA} flex items-center gap-4`}>
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-800">
          <svg
            aria-hidden="true"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12 5 5 9-10" />
          </svg>
        </span>
        <div className="min-w-0">
          <h1
            ref={tituloRef}
            tabIndex={-1}
            className="text-2xl font-bold tracking-tight text-foreground outline-none"
          >
            Gracias por tu compra
          </h1>
          <p className="text-sm text-[#5a575e]">{lugar}</p>
          <p className="text-sm text-[#5a575e]">
            Pedido {codigoPedido(pedidoId)} entregado
            {hora ? ` a las ${hora}` : ""}
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section aria-labelledby="gracias-resumen" className={CLASE_TARJETA}>
          <h2
            id="gracias-resumen"
            className="text-lg font-bold text-foreground"
          >
            Lo que pediste
          </h2>
          <ul className="mt-3 divide-y divide-culinary-neutral/15 border-t border-culinary-neutral/15">
            {lineas.map((l) => (
              <li
                key={l.itemCartaId}
                className="flex items-start justify-between gap-3 py-2 text-sm"
              >
                <span className="text-foreground">
                  {l.cantidad}× {l.nombre}
                </span>
                <span className="shrink-0 text-foreground">
                  {formatearPrecio(l.precio * l.cantidad)}
                </span>
              </li>
            ))}
          </ul>
          {conPropina && totales && (
            <div className="flex items-center justify-between gap-3 border-t border-culinary-neutral/15 py-2 text-sm text-[#5a575e]">
              <span>{etiquetaDePropina(eleccionGuardada(totales))}</span>
              <span>{formatearPrecio(totales.propina)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-culinary-neutral/15 pt-3">
            <span className="font-bold text-foreground">Total abonado</span>
            <span className="text-xl font-bold text-foreground">
              {abonado === null ? "…" : formatearPrecio(abonado)}
            </span>
          </div>
          {comprobanteDisponible && (
            <button
              type="button"
              onClick={onDescargarPdf}
              disabled={descargando}
              className="mt-3 text-sm font-semibold text-[#6e54ad] underline disabled:opacity-60"
            >
              {descargando ? "Descargando…" : "Descargar e-Ticket"}
            </button>
          )}
          {errorDescarga && (
            <p role="alert" className="mt-1 text-xs text-[#BA1A1A]">
              No se pudo descargar el comprobante. Probá de nuevo.
            </p>
          )}
        </section>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onOtroPedido}
            className="w-full rounded-[0.5rem] bg-[#6e54ad] px-4 py-3 font-semibold text-white hover:bg-[#5d4699] focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30"
          >
            Pedir algo más
          </button>
          {pedidosEnCamino > 0 && onVerMisPedidos && (
            <button
              type="button"
              onClick={onVerMisPedidos}
              className="w-full rounded-[0.5rem] border border-[#6e54ad] px-4 py-3 font-semibold text-[#6e54ad] hover:bg-[#6e54ad]/10 focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30"
            >
              {textoEnCamino(pedidosEnCamino)}
            </button>
          )}
          <p className="text-center text-sm text-[#5a575e]">
            ¡Que lo disfrutes!
          </p>
        </div>
      </div>
    </div>
  );
}
