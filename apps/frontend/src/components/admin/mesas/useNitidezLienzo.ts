"use client";

import { useEffect, useState } from "react";

/** Fuente de respaldo mientras la tipografía de la app no terminó de cargar. */
export const FUENTE_RESPALDO_LIENZO = "system-ui, sans-serif";

export interface NitidezLienzo {
  /** Píxeles físicos por píxel CSS de la pantalla actual (zoom del navegador incluido). */
  pixelRatio: number;
  /** Familia tipográfica para los textos de Konva (la misma que el resto de la app). */
  fuente: string;
}

/**
 * Nitidez del mapa de mesas. Konva dibuja en un canvas (una imagen), así que
 * hay dos cosas que el navegador no resuelve solo:
 *
 * - `pixelRatio`: Konva lo lee UNA vez al crear el canvas. Si después se
 *   cambia el zoom del navegador (Ctrl + / Ctrl -) o se pasa la ventana a
 *   otro monitor, el canvas queda con la resolución vieja y se ve
 *   pixelado o borroso. Este hook avisa cada vez que cambia.
 * - `fuente`: el canvas no hereda la tipografía del CSS (usa Arial). Se lee
 *   la del <body> (Plus Jakarta Sans, cargada con next/font) y se vuelve a
 *   leer cuando las fuentes terminan de cargar, para que Konva redibuje.
 *
 * Arranca con valores neutros y se corrige al montar: los reales solo se
 * conocen en el navegador.
 */
export function useNitidezLienzo(): NitidezLienzo {
  const [pixelRatio, setPixelRatio] = useState(1);
  const [fuente, setFuente] = useState(FUENTE_RESPALDO_LIENZO);

  // pixelRatio: la media query de resolución deja de coincidir justo cuando
  // cambia el devicePixelRatio; ahí se mide de nuevo y se arma otra consulta.
  useEffect(() => {
    let consulta: MediaQueryList | null = null;
    const alCambiar = () => {
      consulta?.removeEventListener("change", alCambiar);
      const actual = window.devicePixelRatio || 1;
      setPixelRatio(actual);
      consulta = window.matchMedia(`(resolution: ${actual}dppx)`);
      consulta.addEventListener("change", alCambiar);
    };
    alCambiar();
    return () => consulta?.removeEventListener("change", alCambiar);
  }, []);

  // fuente: next/font le pone un nombre propio a la familia, por eso se lee
  // del estilo calculado en lugar de escribir "Plus Jakarta Sans" a mano.
  // Se pasa a Konva recién cuando el archivo de la fuente está cargado: si
  // Konva mide el texto antes, lo mide con la de respaldo y queda corrido.
  useEffect(() => {
    let activo = true;
    const familia = getComputedStyle(document.body).fontFamily;
    if (!familia) return;
    const aplicar = () => {
      if (activo) setFuente(familia);
    };
    if (!document.fonts) {
      aplicar();
      return;
    }
    // Pesos que usa el mapa: 600 (zonas y elementos) y 700 (números).
    Promise.all([
      document.fonts.load(`600 14px ${familia}`),
      document.fonts.load(`700 16px ${familia}`),
    ])
      .then(aplicar)
      .catch(aplicar);
    return () => {
      activo = false;
    };
  }, []);

  return { pixelRatio, fuente };
}
