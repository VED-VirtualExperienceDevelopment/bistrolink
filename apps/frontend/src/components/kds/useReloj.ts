"use client";

import { useEffect, useState } from "react";

/**
 * HU-038 (BL-208): hora actual (ms epoch) que se actualiza cada
 * `intervaloMs`. Un solo reloj para todo el tablero: todas las comandas
 * cambian a la vez y no hay un temporizador por tarjeta.
 *
 * Con la pestaña en segundo plano el navegador frena los temporizadores; al
 * volver a verla se actualiza enseguida, sin esperar el próximo intervalo.
 */
export function useReloj(intervaloMs: number): number {
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    const actualizar = () => setAhora(Date.now());
    const temporizador = setInterval(actualizar, intervaloMs);
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") actualizar();
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    return () => {
      clearInterval(temporizador);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [intervaloMs]);

  return ahora;
}
