"use client";

import { useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatearPrecio } from "@/components/pago/pago.utils";
import type { Pedido } from "@/types/pedido";
import { lugarDelPedido } from "@/components/retiro/retiro.utils";
import {
  cuerpoDeCancelacion,
  errorDelFormulario,
  instruccionDeDevolucion,
  LARGO_MAXIMO_DETALLE,
  MOTIVOS_CANCELACION,
  nombreDelMedio,
  requiereDevolucionManual,
  rutaCancelacion,
  type FormularioCancelacion,
  type PedidoCancelado,
  type VistaPreviaCancelacion,
} from "./cancelacion.utils";

interface Props {
  readonly pedido: Pedido | null;
  readonly token: string | undefined;
  readonly onClose: () => void;
  readonly onCancelado: (cancelado: PedidoCancelado) => void;
}

const VACIO: FormularioCancelacion = {
  motivo: "",
  detalle: "",
  devolucionConfirmada: false,
};

/**
 * HU-024 (BL-104): el mozo o el administrador cancela un pedido pagado. El
 * diálogo muestra cuánto se devuelve y por qué medio (Mercado Pago se
 * reembolsa solo; el efectivo y el POS, a mano), pide el motivo y, si hay
 * devolución manual, que confirme que la hizo.
 */
export function CancelarPedidoDialog({
  pedido,
  token,
  onClose,
  onCancelado,
}: Props) {
  const [vista, setVista] = useState<VistaPreviaCancelacion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [formulario, setFormulario] = useState<FormularioCancelacion>(VACIO);
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idMotivo = useId();
  const idDetalle = useId();
  const idAyuda = useId();

  useEffect(() => {
    if (!pedido) return;
    setFormulario(VACIO);
    setIntento(false);
    setError(null);
    setVista(null);
    setCargando(true);
    apiFetch<VistaPreviaCancelacion>(rutaCancelacion(pedido.id), token)
      .then(setVista)
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? e.message
            : "No se pudo consultar el pedido. Probá de nuevo.",
        ),
      )
      .finally(() => setCargando(false));
  }, [pedido, token]);

  if (!pedido) return null;

  const errorFormulario = vista ? errorDelFormulario(formulario, vista) : null;
  const noCancelable = vista?.motivoNoCancelable ?? null;

  async function confirmar() {
    setIntento(true);
    if (!pedido || !vista || errorFormulario || noCancelable || enviando) {
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const cancelado = await apiFetch<PedidoCancelado>(
        rutaCancelacion(pedido.id),
        token,
        {
          method: "POST",
          body: JSON.stringify(cuerpoDeCancelacion(formulario)),
        },
      );
      onCancelado(cancelado);
    } catch (e) {
      // 409 (cambió de estado), 400 y 502 (Mercado Pago no reembolsó: el
      // pedido no se canceló) llegan con el mensaje del backend.
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudo cancelar el pedido. Probá de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  }

  const mostrarError = intento && errorFormulario;

  return (
    <Dialog
      open={Boolean(pedido)}
      onClose={onClose}
      title={`Cancelar el pedido (${lugarDelPedido(pedido)})`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void confirmar();
        }}
      >
        {cargando && (
          <p className="text-body-md text-on-surface-variant">
            Consultando el pedido…
          </p>
        )}

        {vista && (
          <>
            <p className="flex justify-between border-b border-outline-variant pb-2 text-body-lg font-medium text-on-surface">
              <span>Se devuelve</span>
              <span>{formatearPrecio(vista.monto)}</span>
            </p>
            {vista.devoluciones.length > 0 && (
              <ul className="space-y-1 text-body-md text-on-surface">
                {vista.devoluciones.map((d) => (
                  <li key={d.pagoId}>
                    <span className="font-medium">
                      {formatearPrecio(d.monto)} con {nombreDelMedio(d.medio)}:
                    </span>{" "}
                    {instruccionDeDevolucion(d)}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-body-sm text-on-surface-variant">
              {vista.repondraStock
                ? "Cocina todavía no lo empezó: el stock vuelve. "
                : ""}
              Se emite la nota de crédito del comprobante. La cancelación no se
              puede deshacer.
            </p>
          </>
        )}

        {noCancelable && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
            {noCancelable}
          </p>
        )}

        {vista && !noCancelable && (
          <>
            <div>
              <label
                htmlFor={idMotivo}
                className="mb-1 block text-label-md text-on-surface-variant"
              >
                Motivo
              </label>
              <select
                id={idMotivo}
                value={formulario.motivo}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    motivo: e.target.value as FormularioCancelacion["motivo"],
                  })
                }
                aria-describedby={mostrarError ? idAyuda : undefined}
                data-autofocus
                className="min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-lg text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Elegí un motivo</option>
                {MOTIVOS_CANCELACION.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={idDetalle}
                className="mb-1 block text-label-md text-on-surface-variant"
              >
                Detalle {formulario.motivo === "OTRO" ? "" : "(opcional)"}
              </label>
              <textarea
                id={idDetalle}
                value={formulario.detalle}
                maxLength={LARGO_MAXIMO_DETALLE}
                rows={2}
                onChange={(e) =>
                  setFormulario({ ...formulario, detalle: e.target.value })
                }
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            {requiereDevolucionManual(vista) && (
              <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body-md text-on-surface">
                <input
                  type="checkbox"
                  checked={formulario.devolucionConfirmada}
                  onChange={(e) =>
                    setFormulario({
                      ...formulario,
                      devolucionConfirmada: e.target.checked,
                    })
                  }
                  className="h-5 w-5 accent-primary"
                />{" "}
                Ya hice la devolución al comensal
              </label>
            )}
            {mostrarError && (
              <p id={idAyuda} className="text-body-sm text-error">
                {errorFormulario}
              </p>
            )}
          </>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Volver
          </button>
          <button
            type="submit"
            disabled={!vista || Boolean(noCancelable) || enviando}
            aria-busy={enviando}
            className="min-h-12 rounded-lg bg-error px-4 text-body-md font-medium text-on-error hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? "Cancelando…" : "Cancelar pedido"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
