"use client";

import { useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  normalizarCodigoRetiro,
  rutaEntregarRetiro,
} from "@/components/retiro/retiro.utils";
import type { Pedido } from "@/types/pedido";

interface Props {
  readonly pedido: Pedido | null;
  readonly token: string | undefined;
  readonly onClose: () => void;
  readonly onEntregado: (pedidoId: string) => void;
}

/**
 * HU-040 (BL-210): el mozo o el administrador entrega un pedido para retirar
 * escribiendo el código que dice el comensal. El backend compara el código
 * con el del pedido; si no coincide, no lo entrega.
 */
export function EntregarRetiroDialog({
  pedido,
  token,
  onClose,
  onEntregado,
}: Props) {
  const [codigo, setCodigo] = useState("");
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idCodigo = useId();
  const idAyuda = useId();
  const idError = useId();

  useEffect(() => {
    setCodigo("");
    setIntento(false);
    setError(null);
  }, [pedido]);

  if (!pedido) return null;

  const normalizado = normalizarCodigoRetiro(codigo);
  const errorFormato =
    intento && !normalizado ? "El código tiene la forma R-042." : null;
  const mensaje = errorFormato ?? error;

  async function entregar() {
    setIntento(true);
    if (!pedido || !normalizado || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await apiFetch(rutaEntregarRetiro(pedido.id), token, {
        method: "POST",
        body: JSON.stringify({ codigo: normalizado }),
      });
      onEntregado(pedido.id);
    } catch (e) {
      // 409 (el código no coincide, ya se entregó, todavía no está listo)
      // llega con el mensaje del backend.
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudo entregar el pedido. Probá de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={Boolean(pedido)}
      onClose={onClose}
      title="Entregar pedido para retirar"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void entregar();
        }}
      >
        <p id={idAyuda} className="text-body-md text-on-surface-variant">
          Pedile al comensal el código de retiro y escribilo acá.
          {pedido.retiro?.nombre
            ? ` El pedido está a nombre de ${pedido.retiro.nombre}.`
            : ""}
        </p>
        <div>
          <label
            htmlFor={idCodigo}
            className="mb-1 block text-label-md text-on-surface-variant"
          >
            Código de retiro
          </label>
          <input
            id={idCodigo}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="R-042"
            maxLength={10}
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
              setError(null);
            }}
            aria-describedby={mensaje ? `${idAyuda} ${idError}` : idAyuda}
            aria-invalid={mensaje ? true : undefined}
            data-autofocus
            className="min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-headline-sm uppercase tracking-widest text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {mensaje && (
          <p
            id={idError}
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
            {mensaje}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-lg px-4 text-label-lg text-on-surface-variant hover:bg-surface-container"
          >
            Volver
          </button>
          <button
            type="submit"
            disabled={enviando}
            className="min-h-12 rounded-lg bg-secondary px-4 text-label-lg font-semibold text-on-secondary hover:opacity-90 disabled:opacity-60"
          >
            {enviando ? "Entregando…" : "Entregar"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
