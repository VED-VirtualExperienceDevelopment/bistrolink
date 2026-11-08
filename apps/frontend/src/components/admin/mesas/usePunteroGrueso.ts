"use client";

import { useEffect, useState } from "react";

const CONSULTA_PUNTERO_GRUESO = "(pointer: coarse)";

/**
 * true si el puntero principal es el dedo (tablet, celular). Konva dibuja en
 * un canvas y no ve las clases `touch:` de Tailwind, así que el editor del
 * plano usa este hook para agrandar las anclas y las zonas de toque.
 *
 * Arranca en false (mouse) y se corrige al montar: el valor real solo se
 * conoce en el navegador.
 */
export function usePunteroGrueso(): boolean {
  const [grueso, setGrueso] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_PUNTERO_GRUESO);
    setGrueso(consulta.matches);
    const alCambiar = (e: MediaQueryListEvent) => setGrueso(e.matches);
    consulta.addEventListener("change", alCambiar);
    return () => consulta.removeEventListener("change", alCambiar);
  }, []);

  return grueso;
}
