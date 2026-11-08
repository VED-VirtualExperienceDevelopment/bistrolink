"use client";

import { useState } from "react";
import { CobrarEfectivoDialog } from "./CobrarEfectivoDialog";
import { CobrarPosDialog } from "./CobrarPosDialog";
import {
  codigoDelPedido,
  formatearMonto,
  horaDelPedido,
  mensajeCobroPosRegistrado,
  mensajeCobroRegistrado,
  motivoSinEfectivo,
  motivoSinPos,
  resumenDeLineas,
  textoSolicitudEfectivo,
  type CobroEfectivoRegistrado,
  type CobroPosRegistrado,
  type PedidoPendienteDeCobro,
} from "./cobros.utils";

interface Props {
  readonly pedidos: PedidoPendienteDeCobro[];
  readonly efectivoHabilitado: boolean;
  /** HU-007b (BL-80): ofrece «Cobrar con el POS». */
  readonly posHabilitado?: boolean;
  readonly token: string | undefined;
  /** Texto cuando no hay pedidos esperando el pago. */
  readonly vacio: string;
  /** Muestra la mesa de cada pedido (en la pantalla de cobros). */
  readonly conMesa?: boolean;
  /** Después de cobrar: la lista se vuelve a pedir al backend. */
  readonly onCobrado: () => void;
}

/**
 * HU-031 (BL-201): pedidos que esperan el pago, con «Cobrar en efectivo» y
 * (HU-007b, BL-80) «Cobrar con el POS», si el local lo tiene habilitado.
 * La usan el panel de la mesa del mapa y la pantalla de cobros pendientes.
 */
export function PedidosPorCobrar({
  pedidos,
  efectivoHabilitado,
  posHabilitado = false,
  token,
  vacio,
  conMesa = false,
  onCobrado,
}: Props) {
  const [seleccionado, setSeleccionado] =
    useState<PedidoPendienteDeCobro | null>(null);
  const [conPos, setConPos] = useState<PedidoPendienteDeCobro | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function cobrado(cobro: CobroEfectivoRegistrado) {
    setSeleccionado(null);
    setAviso(mensajeCobroRegistrado(cobro));
    onCobrado();
  }

  function cobradoConPos(cobro: CobroPosRegistrado) {
    setConPos(null);
    setAviso(mensajeCobroPosRegistrado(cobro));
    onCobrado();
  }

  return (
    <div className="space-y-2">
      {aviso && (
        // <output>: rol «status» implícito, el lector de pantalla lo anuncia.
        <output className="block rounded-lg bg-surface-container px-3 py-2 text-body-md text-on-surface">
          {aviso}
        </output>
      )}

      {pedidos.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">{vacio}</p>
      ) : (
        <ul className="space-y-2">
          {pedidos.map((pedido) => {
            const motivo = motivoSinEfectivo(pedido, efectivoHabilitado);
            const motivoPos = motivoSinPos(pedido, posHabilitado);
            const solicitud = textoSolicitudEfectivo(pedido);
            const idMotivo = `motivo-${pedido.id}`;
            // HU-007b (BL-80): por qué no se puede con el POS, si es otro
            // motivo que el del efectivo (si es el mismo, alcanza con uno).
            const idMotivoPos = `motivo-pos-${pedido.id}`;
            const otroMotivoPos =
              posHabilitado && motivoPos !== null && motivoPos !== motivo;
            let descripcionPos: string | undefined;
            if (otroMotivoPos) descripcionPos = idMotivoPos;
            else if (motivoPos) descripcionPos = idMotivo;
            return (
              <li
                key={pedido.id}
                className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  {solicitud && (
                    <p className="mb-1 inline-flex items-center gap-1 rounded-full bg-tertiary-container px-2 py-0.5 text-label-sm text-on-tertiary-container">
                      <span aria-hidden="true">💵</span>
                      <span>{solicitud}</span>
                    </p>
                  )}
                  <p className="text-body-md font-medium text-on-surface">
                    Pedido {codigoDelPedido(pedido.id)} ·{" "}
                    {formatearMonto(pedido.total)}
                  </p>
                  <p className="text-label-sm text-on-surface-variant">
                    {conMesa && !pedido.mesa.esVirtual
                      ? `Mesa ${pedido.mesa.numero} · `
                      : ""}
                    {horaDelPedido(pedido.createdAt)} ·{" "}
                    {resumenDeLineas(pedido)}
                  </p>
                  {motivo && (
                    <p id={idMotivo} className="text-label-sm text-on-surface-variant">
                      {motivo}
                    </p>
                  )}
                  {otroMotivoPos && (
                    <p id={idMotivoPos} className="text-label-sm text-on-surface-variant">
                      {motivoPos}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAviso(null);
                      setSeleccionado(pedido);
                    }}
                    disabled={motivo !== null}
                    aria-describedby={motivo ? idMotivo : undefined}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-body-md text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 md:flex-none"
                  >
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[20px]"
                    >
                      payments
                    </span>
                    <span>Cobrar en efectivo</span>
                  </button>
                  {posHabilitado && (
                    // HU-007b (BL-80): el cobro lo hace el POS del local;
                    // acá se registra con el número de autorización.
                    <button
                      type="button"
                      onClick={() => {
                        setAviso(null);
                        setConPos(pedido);
                      }}
                      disabled={motivoPos !== null}
                      aria-describedby={descripcionPos}
                      className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-primary px-4 text-body-md text-primary hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50 md:flex-none"
                    >
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-[20px]"
                      >
                        credit_card
                      </span>
                      <span>Cobrar con el POS</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CobrarEfectivoDialog
        pedido={seleccionado}
        token={token}
        onClose={() => setSeleccionado(null)}
        onCobrado={cobrado}
      />
      <CobrarPosDialog
        pedido={conPos}
        token={token}
        onClose={() => setConPos(null)}
        onCobrado={cobradoConPos}
      />
    </div>
  );
}
