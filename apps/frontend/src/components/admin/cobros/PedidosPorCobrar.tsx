"use client";

import { useEffect, useRef, useState } from "react";
import { CobrarEfectivoDialog } from "./CobrarEfectivoDialog";
import { CobrarPosDialog } from "./CobrarPosDialog";
import { CancelarPendienteDialog } from "./CancelarPendienteDialog";
import {
  codigoDelPedido,
  formatearMonto,
  horaDelPedido,
  mensajeCobroPosRegistrado,
  mensajeCobroRegistrado,
  mensajePendienteCancelado,
  motivoSinCancelar,
  motivoSinEfectivo,
  motivoSinPos,
  resumenDeLineas,
  textoPropinaEnLista,
  textoSolicitudEfectivo,
  type CobroEfectivoRegistrado,
  type CobroPosRegistrado,
  type PedidoPendienteDeCobro,
  type PendienteCancelado,
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
  /** Después de cobrar o cancelar: la lista se vuelve a pedir al backend. */
  readonly onCobrado: () => void;
  /**
   * BL-470: pedido al que llevó «Ir a cobrar» desde las alertas. Se destaca,
   * se desplaza a la vista y el foco va a su «Cobrar en efectivo».
   */
  readonly destacadoId?: string | null;
}

/** HU-022 (BL-495): el comensal cambió la propina con el pedido abierto. */
const AVISO_PROPINA_CAMBIADA =
  "La propina del pedido cambió. Revisá el nuevo total antes de cobrar.";

/**
 * HU-031 (BL-201): pedidos que esperan el pago, con «Cobrar en efectivo» y
 * (HU-007b, BL-80) «Cobrar con el POS», si el local lo tiene habilitado.
 * BL-501: «Cancelar pedido», si el comensal se arrepintió o se cargó mal.
 * HU-022 (BL-495): cada pedido muestra la propina que eligió el comensal.
 * La usan el panel de la mesa del mapa y la pantalla de cobros pendientes.
 *
 * BL-470: con `destacadoId`, la fila de ese pedido lleva borde grueso y la
 * etiqueta «Aviso de efectivo» (no solo color). El diálogo de cobro no se
 * abre solo: es dinero, se cobra con una acción explícita.
 */
export function PedidosPorCobrar({
  pedidos,
  efectivoHabilitado,
  posHabilitado = false,
  token,
  vacio,
  conMesa = false,
  onCobrado,
  destacadoId = null,
}: Props) {
  const [seleccionado, setSeleccionado] =
    useState<PedidoPendienteDeCobro | null>(null);
  const [conPos, setConPos] = useState<PedidoPendienteDeCobro | null>(null);
  const [aCancelar, setACancelar] = useState<PedidoPendienteDeCobro | null>(
    null,
  );
  const [aviso, setAviso] = useState<string | null>(null);
  const filaDestacadaRef = useRef<HTMLLIElement>(null);
  const botonDestacadoRef = useRef<HTMLButtonElement>(null);
  const hayDestacado = pedidos.some((p) => p.id === destacadoId);

  // BL-470: una sola vez por pedido destacado, cuando ya está en la lista.
  // Si «Cobrar en efectivo» está deshabilitado, el foco va a la fila.
  useEffect(() => {
    if (!hayDestacado) return;
    filaDestacadaRef.current?.scrollIntoView({ block: "center" });
    const boton = botonDestacadoRef.current;
    if (boton && !boton.disabled) boton.focus();
    else filaDestacadaRef.current?.focus();
  }, [hayDestacado, destacadoId]);

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

  function cancelado(pedido: PendienteCancelado) {
    setACancelar(null);
    setAviso(mensajePendienteCancelado(pedido));
    onCobrado();
  }

  // HU-022 (BL-495): el total que veía el mozo ya no es el del pedido.
  function propinaCambiada() {
    setSeleccionado(null);
    setConPos(null);
    setAviso(AVISO_PROPINA_CAMBIADA);
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
            const propina = textoPropinaEnLista(pedido);
            const idMotivo = `motivo-${pedido.id}`;
            // HU-007b (BL-80): por qué no se puede con el POS, si es otro
            // motivo que el del efectivo (si es el mismo, alcanza con uno).
            const idMotivoPos = `motivo-pos-${pedido.id}`;
            const otroMotivoPos =
              posHabilitado && motivoPos !== null && motivoPos !== motivo;
            let descripcionPos: string | undefined;
            if (otroMotivoPos) descripcionPos = idMotivoPos;
            else if (motivoPos) descripcionPos = idMotivo;
            // BL-501: con un pago con tarjeta en curso no se cancela.
            const motivoCancelar = motivoSinCancelar(pedido);
            const idMotivoCancelar = `motivo-cancelar-${pedido.id}`;
            const otroMotivoCancelar =
              motivoCancelar !== null && motivoCancelar !== motivo;
            let descripcionCancelar: string | undefined;
            if (otroMotivoCancelar) descripcionCancelar = idMotivoCancelar;
            else if (motivoCancelar) descripcionCancelar = idMotivo;
            const destacado = pedido.id === destacadoId;
            return (
              <li
                key={pedido.id}
                ref={destacado ? filaDestacadaRef : undefined}
                tabIndex={destacado ? -1 : undefined}
                className={`relative flex flex-col gap-2 rounded-lg bg-surface-container-lowest p-3 md:flex-row md:items-center md:justify-between ${
                  destacado
                    ? "mt-3 border-[3px] border-primary focus:outline-none"
                    : "border border-outline-variant"
                }`}
              >
                {destacado && (
                  <span className="absolute -top-3 left-3 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-label-sm text-on-primary">
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[14px]"
                    >
                      arrow_forward
                    </span>
                    <span>Aviso de efectivo</span>
                  </span>
                )}
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
                  {propina && (
                    <p className="text-label-md text-on-surface">{propina}</p>
                  )}
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
                  {otroMotivoCancelar && (
                    <p id={idMotivoCancelar} className="text-label-sm text-on-surface-variant">
                      {motivoCancelar}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    ref={destacado ? botonDestacadoRef : undefined}
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
                  {/* BL-501: el comensal se arrepintió o se cargó mal. */}
                  <button
                    type="button"
                    onClick={() => {
                      setAviso(null);
                      setACancelar(pedido);
                    }}
                    disabled={motivoCancelar !== null}
                    aria-describedby={descripcionCancelar}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-outline-variant px-4 text-body-md text-error hover:bg-error-container disabled:cursor-not-allowed disabled:opacity-50 md:flex-none"
                  >
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[20px]"
                    >
                      close
                    </span>
                    <span>Cancelar pedido</span>
                  </button>
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
        onActualizar={propinaCambiada}
      />
      <CobrarPosDialog
        pedido={conPos}
        token={token}
        onClose={() => setConPos(null)}
        onCobrado={cobradoConPos}
        onActualizar={propinaCambiada}
      />
      <CancelarPendienteDialog
        pedido={aCancelar}
        token={token}
        onClose={() => setACancelar(null)}
        onCancelado={cancelado}
      />
    </div>
  );
}
