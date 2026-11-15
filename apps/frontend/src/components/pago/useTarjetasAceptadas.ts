"use client";

import { useEffect, useState } from "react";
import {
  tarjetasDeLaRespuesta,
  type TarjetaAceptada,
} from "./tarjetas-aceptadas.utils";

// Una sola consulta por carga de la página: la lista casi no cambia.
let pedido: Promise<TarjetaAceptada[]> | null = null;

function pedirTarjetas(): Promise<TarjetaAceptada[]> {
  pedido ??= fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/pagos/tarjetas-aceptadas`,
  )
    .then((res) => (res.ok ? res.json() : null))
    .then(tarjetasDeLaRespuesta)
    .catch(() => {
      // Sin la lista se muestra solo el texto; la próxima vez se reintenta.
      pedido = null;
      return [];
    });
  return pedido;
}

/** HU-051 (BL-563): las tarjetas aceptadas, o [] mientras llegan o si falla. */
export function useTarjetasAceptadas(): readonly TarjetaAceptada[] {
  const [tarjetas, setTarjetas] = useState<readonly TarjetaAceptada[]>([]);
  useEffect(() => {
    let vigente = true;
    void pedirTarjetas().then((lista) => {
      if (vigente) setTarjetas(lista);
    });
    return () => {
      vigente = false;
    };
  }, []);
  return tarjetas;
}
