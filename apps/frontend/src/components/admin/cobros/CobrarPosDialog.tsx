"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  codigoDelPedido,
  formatearMonto,
  normalizarAutorizacion,
  nuevaClaveDeCobroPos,
  RUTA_COBRO_POS,
  TARJETAS_POS,
  type CobroPosRegistrado,
  type PedidoPendienteDeCobro,
  type TarjetaPos,
} from "./cobros.utils";

interface Props {
  readonly pedido: PedidoPendienteDeCobro | null;
  readonly token: string | undefined;
  readonly onClose: () => void;
  readonly onCobrado: (cobro: CobroPosRegistrado) => void;
}

/**
 * HU-007b (BL-80): el mozo cobra con el POS del local y después registra el
 * cobro acá: tipo de tarjeta y número de autorización del voucher. El total
 * lo calcula el backend; acá solo se muestra. Nunca se piden datos de la
 * tarjeta.
 */
export function CobrarPosDialog({ pedido, token, onClose, onCobrado }: Props) {
  const [tarjeta, setTarjeta] = useState<TarjetaPos>("DEBITO");
  const [texto, setTexto] = useState("");
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Una clave por diálogo abierto: un doble clic o un reintento manda la
  // misma y el backend no registra dos cobros.
  const claveRef = useRef<string>("");
  const idCampo = useId();
  const idAyuda = useId();
  const nombreGrupo = useId();

  useEffect(() => {
    if (pedido) {
      claveRef.current = nuevaClaveDeCobroPos();
      setTarjeta("DEBITO");
      setTexto("");
      setTocado(false);
      setError(null);
    }
  }, [pedido]);

  if (!pedido) return null;

  const autorizacion = normalizarAutorizacion(texto);
  const conError = tocado && texto.trim() !== "" && autorizacion === null;

  async function confirmar() {
    setTocado(true);
    if (!pedido || autorizacion === null || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const cobro = await apiFetch<CobroPosRegistrado>(RUTA_COBRO_POS, token, {
        method: "POST",
        body: JSON.stringify({
          pedidoId: pedido.id,
          idempotencyKey: claveRef.current,
          tarjeta,
          autorizacion,
        }),
      });
      onCobrado(cobro);
    } catch (e) {
      // 409 (ya pagado, pago con Mercado Pago en curso, POS deshabilitado) y
      // 400 llegan con el mensaje redactado por el backend.
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudo registrar el cobro. Probá de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={Boolean(pedido)}
      onClose={onClose}
      title={`Cobrar con el POS · Pedido ${codigoDelPedido(pedido.id)}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void confirmar();
        }}
      >
        <p className="flex justify-between border-b border-outline-variant pb-2 text-body-lg font-medium text-on-surface">
          <span>Total a cobrar en el POS</span>
          <span>{formatearMonto(pedido.total)}</span>
        </p>

        <fieldset>
          <legend className="mb-1 text-label-md text-on-surface-variant">
            Tarjeta
          </legend>
          <div className="flex gap-2">
            {TARJETAS_POS.map(({ codigo, nombre }) => (
              <label
                key={codigo}
                className="flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-outline-variant px-3 text-body-md text-on-surface has-[:checked]:border-primary has-[:checked]:bg-secondary-container has-[:checked]:font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40"
              >
                <input
                  type="radio"
                  name={nombreGrupo}
                  value={codigo}
                  checked={tarjeta === codigo}
                  onChange={() => setTarjeta(codigo)}
                  className="accent-primary"
                />
                {nombre}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label
            htmlFor={idCampo}
            className="mb-1 block text-label-md text-on-surface-variant"
          >
            Número de autorización
          </label>
          <input
            id={idCampo}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => setTocado(true)}
            aria-invalid={conError}
            aria-describedby={idAyuda}
            data-autofocus
            className="min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-lg text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p
            id={idAyuda}
            className={`mt-1 text-body-sm ${conError ? "text-error" : "text-on-surface-variant"}`}
          >
            {conError
              ? "Tiene que tener entre 4 y 12 letras o números."
              : "Está en el voucher del POS. No ingreses el número de la tarjeta."}
          </p>
        </div>

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
            Cancelar
          </button>
          <button
            type="submit"
            disabled={autorizacion === null || enviando}
            aria-busy={enviando}
            className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? "Registrando…" : "Registrar cobro"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
