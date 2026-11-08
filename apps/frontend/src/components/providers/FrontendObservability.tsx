"use client";

import { useEffect } from "react";
import { configuracionFaro, sanearItem } from "@/lib/observabilidad/faro";

/**
 * BL-214: inicializa Grafana Faro (errores del navegador en Grafana Cloud
 * Frontend Observability). Va una sola vez en el layout raíz.
 *
 * - Las variables NEXT_PUBLIC_* se leen con su nombre literal porque Next.js
 *   las reemplaza en el build (la imagen de Web se construye por entorno).
 * - Sin NEXT_PUBLIC_FARO_URL (local, tests) no se carga nada.
 * - El SDK se importa de forma diferida, después de que la página cargó,
 *   para no sumar peso al bundle inicial (Lighthouse).
 * - captureConsole y la instrumentación de rendimiento quedan apagadas: los
 *   mensajes de consola y las URLs de cada recurso (por ejemplo, las URLs
 *   firmadas de S3) no se mandan. Se mantienen los errores, las Web Vitals
 *   y las sesiones.
 */
let iniciado = false;

export function FrontendObservability() {
  useEffect(() => {
    if (iniciado) {
      return;
    }
    const configuracion = configuracionFaro({
      url: process.env.NEXT_PUBLIC_FARO_URL,
      version: process.env.NEXT_PUBLIC_APP_VERSION,
      entorno: process.env.NEXT_PUBLIC_APP_ENV,
    });
    if (!configuracion) {
      return;
    }
    iniciado = true;

    import("@grafana/faro-web-sdk")
      .then(({ initializeFaro, getWebInstrumentations }) => {
        initializeFaro({
          url: configuracion.url,
          app: configuracion.app,
          instrumentations: getWebInstrumentations({
            captureConsole: false,
            enablePerformanceInstrumentation: false,
          }),
          beforeSend: (item) => sanearItem(item),
          sessionTracking: { enabled: true, persistent: false },
        });
      })
      .catch(() => {
        // Si el SDK no carga (bloqueador de anuncios, red), la app sigue
        // funcionando igual: la observabilidad no puede romper la página.
        iniciado = false;
      });
  }, []);

  return null;
}
