"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { OrigenMenu } from "@/components/menu-digital.utils";
import {
  ESTADO_INICIAL_SUGERENCIA,
  idsDelPedido,
  respuestaDeComplementos,
  rutaComplementos,
  siguienteEstadoSugerencia,
  sugerenciasVisibles,
  type OrigenComplementos,
  type PlatoSugerido,
  type RespuestaComplementos,
} from "./complementos.utils";

async function pedirComplementos(
  ruta: string,
  itemsEnPedido: string[],
): Promise<RespuestaComplementos | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemsEnPedido }),
    });
    if (!res.ok) return null;
    return respuestaDeComplementos(await res.json());
  } catch {
    // Sin red o la API caída: el pedido sigue igual, sin sugerencia.
    return null;
  }
}

/**
 * HU-046 (BL-553): la sugerencia de complementos de un pedido.
 *
 * Se pide una sola vez por pedido, la primera vez que el detalle está a la
 * vista (la columna en escritorio o la hoja abierta en el celular), con los
 * platos que hay en ese momento. No se vuelve a pedir en cada cambio del
 * carrito: cada respuesta con sugerencias cuenta como «mostrada» en la
 * medición (BL-554). Los platos que el comensal agrega después desde la
 * carta se sacan de la sugerencia acá mismo.
 *
 * Al agregar un plato sugerido o elegir «No, gracias» queda resuelta. Se
 * reinicia cuando el carrito queda vacío (lo vació, quitó todo o se aprobó
 * el pago): el próximo pedido vuelve a tener su sugerencia.
 */
export function useSugerenciaComplementos({
  origen,
  lineas,
  detalleVisible,
}: {
  readonly origen: OrigenMenu;
  readonly lineas: readonly { readonly itemCartaId: string }[];
  readonly detalleVisible: boolean;
}): {
  readonly origen: OrigenComplementos;
  readonly platos: readonly PlatoSugerido[];
  readonly resolver: () => void;
} {
  const [estado, despachar] = useReducer(
    siguienteEstadoSugerencia,
    ESTADO_INICIAL_SUGERENCIA,
  );
  const ruta = rutaComplementos(origen);
  const hayLineas = lineas.length > 0;
  // Los ids del momento en que se pide, sin volver a correr el efecto en
  // cada cambio del carrito.
  const idsRef = useRef<string[]>([]);
  idsRef.current = idsDelPedido(lineas);
  // El último pedido para el que ya se hizo la consulta (en desarrollo,
  // React corre dos veces los efectos y no hay que pedir dos veces).
  const consultadoRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hayLineas) despachar({ tipo: "reiniciar" });
  }, [hayLineas]);

  useEffect(() => {
    if (
      !ruta ||
      !detalleVisible ||
      !hayLineas ||
      estado.fase !== "pendiente" ||
      consultadoRef.current === estado.pedido
    ) {
      return;
    }
    const pedido = estado.pedido;
    consultadoRef.current = pedido;
    despachar({ tipo: "pedir" });
    void pedirComplementos(ruta, idsRef.current).then((respuesta) =>
      despachar({ tipo: "recibir", pedido, respuesta }),
    );
  }, [ruta, detalleVisible, hayLineas, estado.fase, estado.pedido]);

  const resolver = useCallback(() => despachar({ tipo: "resolver" }), []);

  return {
    origen: estado.respuesta?.origen ?? "ninguno",
    platos: sugerenciasVisibles(estado, lineas),
    resolver,
  };
}
