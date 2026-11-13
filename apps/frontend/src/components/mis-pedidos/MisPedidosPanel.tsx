"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { descargarArchivo, type ArchivoBase64 } from "@/lib/descarga";
import { ESTADO_LABEL } from "@/components/kds/OrderTicket";
import { lugarVigente, textoEnCola } from "@/components/kds/cola-kds.utils";
import type { PosicionEnCola } from "@/components/kds/cola-kds.utils";
import { etiquetaMesa, type OrigenMenu } from "@/components/menu-digital.utils";
import {
  codigoPedido,
  formatearPrecio,
  headersAccesoPedido,
  rutaPdfComprobante,
} from "@/components/pago/pago.utils";
import {
  horaCorta,
  resumenDeLineas,
  tonoDelEstado,
  totalDelPedido,
  type PedidoDeLaMesa,
  type TonoEstado,
} from "./mis-pedidos.utils";

interface Props {
  readonly abierto: boolean;
  readonly onCerrar: () => void;
  /** Vuelve a la carta (cierra el panel y, si hace falta, la pantalla de pago). */
  readonly onPedirAlgoMas: () => void;
  readonly origen: OrigenMenu;
  readonly numeroMesa?: number;
  readonly pedidos: readonly PedidoDeLaMesa[];
  readonly lugares: Readonly<Record<string, PosicionEnCola>>;
  readonly accessToken: string | null;
}

/** Colores de la etiqueta del estado (WCAG AA sobre su fondo). */
const CLASE_TONO: Record<TonoEstado, string> = {
  espera: "bg-amber-50 text-amber-900",
  listo: "bg-culinary-primary-container text-[#4f378a]",
  entregado: "bg-emerald-50 text-emerald-900",
  cancelado: "bg-red-50 text-red-900",
};

/** Con el pago aprobado ya puede haber comprobante (el CFE se emite al pagar). */
const CON_COMPROBANTE = new Set<PedidoDeLaMesa["estado"]>([
  "RECIBIDO",
  "EN_PREPARACION",
  "LISTO_PARA_ENTREGAR",
  "ENTREGADO",
]);

/**
 * BL-502: «Mis pedidos» en la mesa. En el celular ocupa toda la pantalla;
 * desde lg es un panel a la derecha, con la carta visible al costado.
 * <dialog> nativo: atrapa el foco, cierra con Escape y devuelve el foco al
 * botón que lo abrió.
 */
export function MisPedidosPanel({
  abierto,
  onCerrar,
  onPedirAlgoMas,
  origen,
  numeroMesa,
  pedidos,
  lugares,
  accessToken,
}: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);

  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    if (abierto && !el.open) el.showModal();
    if (!abierto && el.open) el.close();
  }, [abierto]);

  async function descargar(pedidoId: string) {
    if (!accessToken) return;
    setDescargando(pedidoId);
    setErrorDescarga(null);
    try {
      const archivo = await apiFetch<ArchivoBase64>(
        rutaPdfComprobante(pedidoId),
        accessToken,
        { headers: headersAccesoPedido(origen) },
      );
      descargarArchivo(archivo);
    } catch {
      setErrorDescarga(pedidoId);
    } finally {
      setDescargando(null);
    }
  }

  const titulo =
    numeroMesa === undefined
      ? "Mis pedidos"
      : `Mis pedidos · ${etiquetaMesa(numeroMesa)}`;

  return (
    <dialog
      ref={dialogo}
      onClose={onCerrar}
      aria-labelledby="titulo-mis-pedidos"
      data-testid="mis-pedidos-panel"
      className="m-0 h-full max-h-none w-full max-w-none bg-culinary-background p-0 backdrop:bg-black/40 lg:ml-auto lg:w-[420px] lg:border-l lg:border-culinary-neutral/15"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-culinary-neutral/15 bg-white px-4 py-4">
          <h2
            id="titulo-mis-pedidos"
            className="truncate text-lg font-bold text-foreground"
          >
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar mis pedidos"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground hover:bg-culinary-neutral/10 focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30"
          >
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
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {pedidos.length === 0 ? (
            <p className="text-sm text-[#5a575e]">
              Todavía no hiciste pedidos en esta mesa.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pedidos.map((pedido) => {
                const lugar = lugarVigente(
                  pedido.estado,
                  lugares[pedido.id] ?? null,
                );
                return (
                  <li
                    key={pedido.id}
                    data-pedido-id={pedido.id}
                    className="rounded-[0.75rem] border border-culinary-neutral/15 bg-white p-4"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-bold text-foreground">
                        {codigoPedido(pedido.id)}
                      </span>
                      <span className="text-xs text-[#5a575e]">
                        {horaCorta(pedido.creadoEn)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#5a575e]">
                      {resumenDeLineas(pedido)}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span
                        data-testid="estado-pedido-mesa"
                        className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${CLASE_TONO[tonoDelEstado(pedido.estado)]}`}
                      >
                        {ESTADO_LABEL[pedido.estado]}
                      </span>
                      <span className="text-sm font-semibold text-foreground">
                        {formatearPrecio(totalDelPedido(pedido))}
                      </span>
                    </div>
                    {lugar && (
                      <p className="mt-2 text-xs text-[#5a575e]">
                        {textoEnCola(lugar)}
                      </p>
                    )}
                    {CON_COMPROBANTE.has(pedido.estado) && (
                      <button
                        type="button"
                        onClick={() => void descargar(pedido.id)}
                        disabled={descargando === pedido.id}
                        className="mt-2 text-sm font-semibold text-[#6e54ad] underline disabled:opacity-60"
                      >
                        {descargando === pedido.id
                          ? "Descargando…"
                          : "Descargar comprobante"}
                      </button>
                    )}
                    {errorDescarga === pedido.id && (
                      <p role="alert" className="mt-1 text-xs text-[#BA1A1A]">
                        El comprobante todavía no está listo. Probá en un rato.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 text-xs text-[#5a575e]">
            Ves los pedidos que hiciste desde este teléfono mientras la mesa
            está abierta.
          </p>
        </div>

        <footer className="border-t border-culinary-neutral/15 bg-white px-4 py-4">
          <button
            type="button"
            onClick={onPedirAlgoMas}
            className="w-full rounded-[0.5rem] border border-[#6e54ad] px-4 py-3 font-semibold text-[#6e54ad] hover:bg-[#6e54ad]/10 focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30"
          >
            Pedir algo más
          </button>
        </footer>
      </div>
    </dialog>
  );
}
