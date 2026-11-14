"use client";

import { useEffect, useRef, useState } from "react";
import {
  permisoDeAviso,
  textoAvisoListo,
  type PermisoAviso,
} from "./retiro.utils";

interface Props {
  /** El pedido llegó a LISTO_PARA_ENTREGAR. */
  readonly listo: boolean;
  /** Código de retiro (R-042), si ya se conoce. */
  readonly codigo: string | null;
}

/**
 * HU-040 (BL-210): aviso al comensal de un pedido para retirar.
 *
 * El estado llega por el WebSocket de SeguimientoPedido, así que el cartel
 * aparece sin recargar. Si el comensal da permiso, además se muestra una
 * notificación del navegador (sirve con la pestaña abierta pero en segundo
 * plano; no es una notificación push con la pestaña cerrada).
 */
export function AvisoRetiro({ listo, codigo }: Props) {
  const [permiso, setPermiso] = useState<PermisoAviso>("no-soportado");
  const avisado = useRef(false);

  // Se lee recién en el navegador (en el servidor no hay Notification).
  useEffect(() => {
    setPermiso(permisoDeAviso(globalThis));
  }, []);

  useEffect(() => {
    if (!listo || avisado.current) return;
    avisado.current = true;
    globalThis.navigator?.vibrate?.([200, 100, 200]);
    if (permisoDeAviso(globalThis) !== "granted") return;
    const { titulo, cuerpo } = textoAvisoListo(codigo);
    try {
      const aviso = new Notification(titulo, {
        body: cuerpo,
        tag: "pedido-listo",
      });
      aviso.onclick = () => {
        globalThis.focus();
        aviso.close();
      };
    } catch {
      // Chrome en Android solo acepta notificaciones desde un service
      // worker: queda el cartel de la pantalla.
    }
  }, [listo, codigo]);

  async function activarAviso() {
    try {
      await Notification.requestPermission();
    } finally {
      setPermiso(permisoDeAviso(globalThis));
    }
  }

  if (listo) {
    return (
      <div
        role="alert"
        data-testid="aviso-listo-para-retirar"
        className="mt-4 rounded-[0.75rem] bg-culinary-primary-container px-4 py-4 text-center"
      >
        <p className="text-lg font-bold text-[#6e54ad]">
          Tu pedido está listo para retirar
        </p>
        <p className="mt-1 text-sm text-foreground">
          {codigo ? (
            <>
              Acercate al mostrador y decí el código{" "}
              <strong className="font-bold">{codigo}</strong>.
            </>
          ) : (
            "Acercate al mostrador a retirarlo."
          )}
        </p>
      </div>
    );
  }

  if (permiso === "default") {
    return (
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => void activarAviso()}
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#6e54ad] text-[#6e54ad] font-semibold rounded-[0.5rem] hover:bg-[#6e54ad]/10 focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30 transition-colors"
        >
          Avisarme cuando esté listo
        </button>
      </div>
    );
  }

  if (permiso === "granted") {
    return (
      <p className="mt-4 text-center text-xs text-[#5a575e]">
        Te avisamos cuando esté listo. Dejá esta pestaña abierta.
      </p>
    );
  }

  return null;
}
