"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  codigoDelPedido,
  desglosePropina,
  esTotalCambiado,
  evaluarMontoRecibido,
  formatearMonto,
  montoRecibidoInicial,
  nuevaClaveDeCobro,
  RUTA_COBRO_EFECTIVO,
  type CobroEfectivoRegistrado,
  type PedidoPendienteDeCobro,
} from "./cobros.utils";

interface Props {
  readonly pedido: PedidoPendienteDeCobro | null;
  readonly token: string | undefined;
  readonly onClose: () => void;
  readonly onCobrado: (cobro: CobroEfectivoRegistrado) => void;
  /**
   * HU-022 (BL-495): el comensal cambió la propina mientras el mozo tenía el
   * pedido abierto. Cierra el diálogo y vuelve a pedir la lista.
   */
  readonly onActualizar: () => void;
}

/**
 * HU-031 (BL-201): el mozo ingresa lo que entregó el comensal, ve el vuelto
 * y confirma. El total lo calcula el backend; acá solo se muestra.
 * HU-022 (BL-495): el total incluye la propina que eligió el comensal. El
 * mozo la ve desglosada pero no la puede cambiar; se manda el total que vio
 * para que el backend rechace el cobro si cambió.
 */
export function CobrarEfectivoDialog({
  pedido,
  token,
  onClose,
  onCobrado,
  onActualizar,
}: Props) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCambiado, setTotalCambiado] = useState(false);
  // Una clave por diálogo abierto: un doble clic o un reintento manda la
  // misma y el backend no registra dos cobros.
  const claveRef = useRef<string>("");
  const idCampo = useId();
  const idAyuda = useId();

  useEffect(() => {
    if (pedido) {
      claveRef.current = nuevaClaveDeCobro();
      // HU-031b (BL-442): si el comensal dijo con cuánto paga, ya viene cargado.
      setTexto(montoRecibidoInicial(pedido));
      setError(null);
      setTotalCambiado(false);
    }
  }, [pedido]);

  if (!pedido) return null;

  const estado = evaluarMontoRecibido(texto, pedido.total);
  const desglose = desglosePropina(pedido);

  async function confirmar() {
    if (!pedido || estado.tipo !== "ok" || enviando || totalCambiado) return;
    setEnviando(true);
    setError(null);
    try {
      const cobro = await apiFetch<CobroEfectivoRegistrado>(
        RUTA_COBRO_EFECTIVO,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            pedidoId: pedido.id,
            idempotencyKey: claveRef.current,
            montoRecibido: estado.recibido,
            // HU-022 (BL-495): el total que el mozo está viendo.
            totalEsperado: pedido.total,
          }),
        },
      );
      onCobrado(cobro);
    } catch (e) {
      // 409 (ya pagado, tarjeta en curso, efectivo deshabilitado, total
      // cambiado) y 400 llegan con el mensaje redactado por el backend.
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

  let ayuda = "Ingresá cuánto te entregó el comensal.";
  if (estado.tipo === "invalido") {
    ayuda = "Ingresá un monto válido, con hasta 2 decimales.";
  } else if (estado.tipo === "insuficiente") {
    ayuda = `Faltan ${formatearMonto(estado.falta)} para cubrir el total.`;
  } else if (estado.tipo === "ok") {
    ayuda = `Vuelto: ${formatearMonto(estado.vuelto)}`;
  }
  const conError = estado.tipo === "invalido" || estado.tipo === "insuficiente";

  return (
    <Dialog
      open={Boolean(pedido)}
      onClose={onClose}
      title={`Cobrar en efectivo · Pedido ${codigoDelPedido(pedido.id)}`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void confirmar();
        }}
      >
        <ul className="space-y-1 text-body-md text-on-surface">
          {pedido.lineas.map((linea) => (
            <li key={linea.id} className="flex justify-between gap-3">
              <span>
                {linea.cantidad} × {linea.nombre}
              </span>
              <span>{formatearMonto(linea.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-outline-variant pt-2">
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
            <span>Total</span>
            <span>{formatearMonto(pedido.total)}</span>
          </p>
        </div>

        <div>
          <label
            htmlFor={idCampo}
            className="mb-1 block text-label-md text-on-surface-variant"
          >
            Monto recibido
          </label>
          <input
            id={idCampo}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-invalid={conError}
            aria-describedby={idAyuda}
            data-autofocus
            className="min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-lg text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {/* Región en vivo: el lector de pantalla anuncia el vuelto. */}
          <output
            id={idAyuda}
            className={`mt-1 block text-body-md ${conError ? "text-error" : "text-on-surface"}`}
          >
            {ayuda}
          </output>
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
              disabled={estado.tipo !== "ok" || enviando}
              aria-busy={enviando}
              className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? "Registrando…" : "Confirmar cobro"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
