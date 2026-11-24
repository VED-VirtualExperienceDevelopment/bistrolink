"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  codigoDelPedido,
  desglosePropina,
  esTotalCambiado,
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
  /**
   * HU-022 (BL-495): el comensal cambió la propina mientras el mozo tenía el
   * pedido abierto. Cierra el diálogo y vuelve a pedir la lista.
   */
  readonly onActualizar: () => void;
}

/**
 * HU-007b (BL-80): el mozo cobra con el POS del local y después registra el
 * cobro acá: tipo de tarjeta y número de autorización del voucher. El total
 * lo calcula el backend; acá solo se muestra. Nunca se piden datos de la
 * tarjeta.
 * HU-022 (BL-495): el total incluye la propina que eligió el comensal. El
 * mozo la ve desglosada pero no la puede cambiar; se manda el total que vio
 * para que el backend rechace el cobro si cambió.
 */
export function CobrarPosDialog({
  pedido,
  token,
  onClose,
  onCobrado,
  onActualizar,
}: Props) {
  const [tarjeta, setTarjeta] = useState<TarjetaPos>("DEBITO");
  const [texto, setTexto] = useState("");
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCambiado, setTotalCambiado] = useState(false);
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
      setTotalCambiado(false);
    }
  }, [pedido]);

  if (!pedido) return null;

  const autorizacion = normalizarAutorizacion(texto);
  const conError = tocado && texto.trim() !== "" && autorizacion === null;
  const desglose = desglosePropina(pedido);

  async function confirmar() {
    setTocado(true);
    if (!pedido || autorizacion === null || enviando || totalCambiado) return;
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
          // HU-022 (BL-495): el total que el mozo está viendo.
          totalEsperado: pedido.total,
        }),
      });
      onCobrado(cobro);
    } catch (e) {
      // 409 (ya pagado, pago con Mercado Pago en curso, POS deshabilitado,
      // total cambiado) y 400 llegan con el mensaje redactado por el backend.
      const mensaje =
        e instanceof ApiError
          ? e.message
          : "No se pudo registrar el cobro. Probá de nuevo.";
      setError(mensaje);
      setTotalCambiado(esTotalCambiado(mensaje));
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
        <div className="space-y-1 border-b border-outline-variant pb-2">
          {desglose && (
            <>
              <p className="flex justify-between text-body-md text-on-surface-variant">
                <span>Consumo</span>
                <span>{formatearMonto(desglose.consumo)}</span>
              </p>
              <p className="flex justify-between text-body-md text-on-surface-variant">
                <span>{desglose.etiqueta}</span>
                <span>{formatearMonto(desglose.propina)}</span>
              </p>
            </>
          )}
          <p className="flex justify-between text-body-lg font-medium text-on-surface">
            <span>Total a cobrar en el POS</span>
            <span>{formatearMonto(pedido.total)}</span>
          </p>
        </div>

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
          {totalCambiado ? (
            <button
              type="button"
              onClick={onActualizar}
              className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90"
            >
              Actualizar lista
            </button>
          ) : (
            <button
              type="submit"
              disabled={autorizacion === null || enviando}
              aria-busy={enviando}
              className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? "Registrando…" : "Registrar cobro"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
