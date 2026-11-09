"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  codigoDelPedido,
  formatearMonto,
  rutaCancelarPendiente,
  type PendienteCancelado,
} from "./cobros.utils";

interface Props {
  /** El pedido a cancelar; null cierra el diálogo. */
  readonly pedido: { id: string; total: string } | null;
  readonly token: string | undefined;
  readonly onClose: () => void;
  readonly onCancelado: (cancelado: PendienteCancelado) => void;
}

/**
 * BL-501: confirma la cancelación de un pedido que todavía no se cobró (el
 * comensal se arrepintió o se cargó por error). No se devuelve nada porque
 * no hubo cobro, y el pedido no pasa a cocina.
 */
export function CancelarPendienteDialog({
  pedido,
  token,
  onClose,
  onCancelado,
}: Props) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pedido) setError(null);
  }, [pedido]);

  if (!pedido) return null;

  async function confirmar() {
    if (!pedido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      onCancelado(
        await apiFetch<PendienteCancelado>(
          rutaCancelarPendiente(pedido.id),
          token,
          { method: "POST" },
        ),
      );
    } catch (e) {
      // 409 (ya se cobró, ya estaba cancelado, pago con tarjeta en curso) y
      // 404 llegan con el mensaje del backend.
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudo cancelar el pedido. Probá de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={Boolean(pedido)}
      onClose={onClose}
      title={`Cancelar el pedido ${codigoDelPedido(pedido.id)}`}
    >
      <div className="space-y-4">
        <p className="text-body-md text-on-surface">
          El pedido de {formatearMonto(pedido.total)} todavía no se cobró. Si lo
          cancelás, no pasa a cocina y sale de los cobros pendientes. No se
          puede deshacer.
        </p>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            data-autofocus
            className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Volver
          </button>
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={enviando}
            aria-busy={enviando}
            className="min-h-12 rounded-lg bg-error px-4 text-body-md font-medium text-on-error hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? "Cancelando…" : "Cancelar pedido"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
