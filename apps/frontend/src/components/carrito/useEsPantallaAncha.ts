"use client";

import { useSyncExternalStore } from "react";
import { CONSULTA_PANTALLA_ANCHA } from "./carrito.utils";

function suscribir(avisar: () => void): () => void {
  const consulta = globalThis.matchMedia(CONSULTA_PANTALLA_ANCHA);
  consulta.addEventListener("change", avisar);
  return () => consulta.removeEventListener("change", avisar);
}

const enElNavegador = () =>
  globalThis.matchMedia(CONSULTA_PANTALLA_ANCHA).matches;

// En el servidor no hay pantalla: se arranca como celular. El carrito empieza
// vacío, así que al hidratar no hay nada del carrito que cambie de lugar.
const enElServidor = () => false;

/** BL-519: true desde lg (columna a la derecha), false en el celular. */
export function useEsPantallaAncha(): boolean {
  return useSyncExternalStore(suscribir, enElNavegador, enElServidor);
}
