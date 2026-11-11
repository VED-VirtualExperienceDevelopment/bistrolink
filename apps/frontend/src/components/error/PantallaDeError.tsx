"use client";

import { useEffect, useState } from "react";
import {
  CLAVE_RECARGA_POR_VERSION,
  DEMORA_ANTES_DE_RECARGAR_MS,
  esErrorDeChunk,
  puedeRecargar,
} from "@/app/error.utils";

/**
 * BL-517: contenido de las dos páginas de error de la app, `app/error.tsx`
 * (errores de las páginas) y `app/global-error.tsx` (errores del layout
 * raíz). Antes se veía la pantalla genérica de Next («Application error: a
 * client-side exception has occurred»).
 *
 * Si el error es de un chunk (la pestaña quedó con la versión anterior a un
 * deploy), recarga una sola vez para traer la versión nueva. Si después de
 * recargar sigue fallando, no vuelve a recargar sola: muestra el botón.
 *
 * El error se manda a Faro a mano: al atraparlo una página de error, ya no
 * llega al manejador global del navegador. El SDK se importa de forma
 * diferida, igual que en FrontendObservability; si Faro no está iniciado
 * (por ejemplo, porque falló el layout raíz, que es quien lo inicia), no se
 * manda nada.
 */
export function PantallaDeError({
  error,
  onReintentar,
}: {
  error: Error & { digest?: string };
  onReintentar: () => void;
}) {
  const deVersion = esErrorDeChunk(error);
  const [recargando, setRecargando] = useState(false);

  useEffect(() => {
    import("@grafana/faro-web-sdk")
      .then(({ faro }) => faro.api?.pushError(error))
      .catch(() => {
        // La observabilidad no puede romper la página de error.
      });
  }, [error]);

  useEffect(() => {
    if (!deVersion) return;
    try {
      const ultima = sessionStorage.getItem(CLAVE_RECARGA_POR_VERSION);
      if (!puedeRecargar(Date.now(), ultima)) return;
      sessionStorage.setItem(CLAVE_RECARGA_POR_VERSION, String(Date.now()));
    } catch {
      // Sin sessionStorage no se puede evitar un loop: no se recarga sola.
      return;
    }
    setRecargando(true);
    const temporizador = setTimeout(
      () => window.location.reload(),
      DEMORA_ANTES_DE_RECARGAR_MS,
    );
    return () => clearTimeout(temporizador);
  }, [deVersion]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <h1 className="text-headline-sm font-bold text-on-surface">
        {deVersion ? "Hay una versión nueva de BistroLink" : "Algo salió mal"}
      </h1>
      <p className="text-body-md text-on-surface-variant" aria-live="polite">
        {deVersion
          ? recargando
            ? "Recargando la página…"
            : "Recargá la página para seguir. Tu pedido confirmado y tu pago en curso no se pierden."
          : "Probá de nuevo. Si el problema sigue, avisale al personal del local."}
      </p>
      {!recargando && (
        <button
          type="button"
          onClick={() => (deVersion ? window.location.reload() : onReintentar())}
          className="rounded-full bg-primary px-6 py-3 font-semibold text-on-primary"
        >
          {deVersion ? "Recargar" : "Reintentar"}
        </button>
      )}
    </main>
  );
}
