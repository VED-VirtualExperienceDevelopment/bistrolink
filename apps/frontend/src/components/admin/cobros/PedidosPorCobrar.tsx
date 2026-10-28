"use client";

import { useState } from "react";
import { CobrarEfectivoDialog } from "./CobrarEfectivoDialog";
import {
  codigoDelPedido,
  formatearMonto,
  horaDelPedido,
  mensajeCobroRegistrado,
  motivoSinEfectivo,
  resumenDeLineas,
  textoSolicitudEfectivo,
  type CobroEfectivoRegistrado,
  type PedidoPendienteDeCobro,
} from "./cobros.utils";

interface Props {
  readonly pedidos: PedidoPendienteDeCobro[];
  readonly efectivoHabilitado: boolean;
  readonly token: string | undefined;
  /** Texto cuando no hay pedidos esperando el pago. */
  readonly vacio: string;
  /** Muestra la mesa de cada pedido (en la pantalla de cobros). */
  readonly conMesa?: boolean;
  /** Después de cobrar: la lista se vuelve a pedir al backend. */
  readonly onCobrado: () => void;
}

/**
 * HU-031 (BL-201): pedidos que esperan el pago, con «Cobrar en efectivo».
 * La usan el panel de la mesa del mapa y la pantalla de cobros pendientes.
 */
export function PedidosPorCobrar({
  pedidos,
  efectivoHabilitado,
  token,
  vacio,
  conMesa = false,
  onCobrado,
}: Props) {
  const [seleccionado, setSeleccionado] =
    useState<PedidoPendienteDeCobro | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function cobrado(cobro: CobroEfectivoRegistrado) {
    setSeleccionado(null);
    setAviso(mensajeCobroRegistrado(cobro));
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
            const solicitud = textoSolicitudEfectivo(pedido);
            const idMotivo = `motivo-${pedido.id}`;
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
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAviso(null);
                    setSeleccionado(pedido);
                  }}
                  disabled={motivo !== null}
                  aria-describedby={motivo ? idMotivo : undefined}
                  className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-body-md text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[20px]"
                  >
                    payments
                  </span>
                  <span>Cobrar en efectivo</span>
                </button>
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
    </div>
  );
}
