"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Dialog } from "@/components/ui/Dialog";
import { useReloj } from "@/components/kds/useReloj";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  AVISO_OTRO_LINK,
  CODIGO_LINK_ACTIVO,
  codigoDelPedido,
  cuerpoLinkPago,
  formatearMonto,
  rutaLinkPago,
  textoLinkActivo,
  textoVencimientoLink,
  type LinkPagoGenerado,
  type PedidoPendienteDeCobro,
} from "./cobros.utils";

interface Props {
  /** El pedido del link; null cierra el diálogo. */
  readonly pedido: PedidoPendienteDeCobro | null;
  readonly token: string | undefined;
  readonly onClose: () => void;
  /** Después de generar: la lista se vuelve a pedir (muestra el link activo). */
  readonly onGenerado: () => void;
}

type Estado =
  | { tipo: "confirmar"; aviso: string }
  | { tipo: "generando" }
  | { tipo: "listo"; link: LinkPagoGenerado; qr: string }
  | { tipo: "error"; mensaje: string };

const RELOJ_MS = 15_000;

/**
 * HU-033 (BL-203): link de pago de un pedido pendiente. El mozo lo genera y
 * el comensal lo abre en su celular, escaneando el QR o con la URL.
 *
 * - Si el pedido ya tiene un link activo, primero avisa que generar otro
 *   invalida el anterior (el link no se guarda: solo se ve al generarlo).
 *   Si la lista estaba desactualizada (otro colaborador lo generó), el
 *   backend responde 409 LINK_PAGO_ACTIVO y se muestra el mismo aviso.
 * - Muestra el QR, la URL para copiar y cuándo vence.
 * - No se manda por WhatsApp (HU-010, trabajo futuro).
 */
export function LinkPagoDialog({ pedido, token, onClose, onGenerado }: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: "generando" });
  const [copiado, setCopiado] = useState(false);
  const ahora = useReloj(RELOJ_MS);

  const generar = useCallback(
    async (id: string, reemplazar: boolean) => {
      setEstado({ tipo: "generando" });
      setCopiado(false);
      try {
        const link = await apiFetch<LinkPagoGenerado>(rutaLinkPago(id), token, {
          method: "POST",
          body: cuerpoLinkPago(reemplazar),
        });
        const qr = await QRCode.toDataURL(link.url, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 240,
        });
        setEstado({ tipo: "listo", link, qr });
        onGenerado();
      } catch (e) {
        if (e instanceof ApiError && e.codigo === CODIGO_LINK_ACTIVO) {
          // Otro colaborador lo generó: se confirma antes de reemplazarlo y
          // la lista se actualiza (muestra hasta cuándo sirve).
          setEstado({ tipo: "confirmar", aviso: AVISO_OTRO_LINK });
          onGenerado();
          return;
        }
        // 409 (ya no espera el pago, pago en curso) y 404 llegan con el
        // mensaje del backend.
        setEstado({
          tipo: "error",
          mensaje:
            e instanceof ApiError
              ? e.message
              : "No se pudo generar el link. Probá de nuevo.",
        });
      }
    },
    [token, onGenerado],
  );

  // Al abrir: si ya hay un link activo, se confirma antes de reemplazarlo.
  // Una sola vez por pedido: no cuando la lista se actualiza (después de
  // generar, el pedido llega de nuevo con el link activo).
  const abiertoPara = useRef<string | null>(null);
  useEffect(() => {
    if (!pedido) {
      abiertoPara.current = null;
      return;
    }
    if (abiertoPara.current === pedido.id) return;
    abiertoPara.current = pedido.id;
    const activo = textoLinkActivo(pedido);
    if (activo) {
      setEstado({ tipo: "confirmar", aviso: activo });
    } else {
      void generar(pedido.id, false);
    }
  }, [pedido, generar]);

  if (!pedido) return null;

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <Dialog
      open={Boolean(pedido)}
      onClose={onClose}
      title={`Link de pago · Pedido ${codigoDelPedido(pedido.id)}`}
    >
      <div className="space-y-4">
        <p className="text-body-md text-on-surface">
          Total: {formatearMonto(pedido.total)}. El comensal lo paga con tarjeta
          desde su celular; al aprobarse, el pedido pasa a cocina.
        </p>

        {estado.tipo === "confirmar" && (
          <div className="space-y-3">
            <p className="rounded-lg bg-surface-container px-3 py-2 text-body-md text-on-surface">
              {estado.aviso}. Si generás otro, el anterior deja de servir.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
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
                onClick={() => void generar(pedido.id, true)}
                className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90"
              >
                Generar otro link
              </button>
            </div>
          </div>
        )}

        {estado.tipo === "generando" && (
          <p
            aria-live="polite"
            className="text-body-md text-on-surface-variant"
          >
            Generando el link…
          </p>
        )}

        {estado.tipo === "error" && (
          <div className="space-y-3">
            <p
              role="alert"
              className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
            >
              {estado.mensaje}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                data-autofocus
                className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {estado.tipo === "listo" && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- QR generado acá (data: URL) */}
              <img
                src={estado.qr}
                width={240}
                height={240}
                alt={`QR del link de pago del pedido ${codigoDelPedido(pedido.id)}`}
                className="rounded-lg border border-outline-variant bg-white p-2"
              />
              <p className="text-body-sm text-on-surface-variant">
                El comensal lo escanea con la cámara del celular.
              </p>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="link-pago-url"
                className="text-label-md text-on-surface"
              >
                Link para copiar
              </label>
              <div className="flex gap-2">
                <input
                  id="link-pago-url"
                  readOnly
                  value={estado.link.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-h-12 w-full min-w-0 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-sm text-on-surface"
                />
                <button
                  type="button"
                  onClick={() => void copiar(estado.link.url)}
                  data-autofocus
                  className="min-h-12 shrink-0 rounded-lg border border-primary px-4 text-body-md text-primary hover:bg-surface-container"
                >
                  {copiado ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>

            <p
              className="text-body-sm text-on-surface-variant"
              aria-live="polite"
            >
              {textoVencimientoLink(estado.link.venceEn, ahora)}
              {copiado && " · Link copiado"}
            </p>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => void generar(pedido.id, true)}
                className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
              >
                Generar otro link
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90"
              >
                Listo
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
