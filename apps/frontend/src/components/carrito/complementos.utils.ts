import type { OrigenMenu } from "@/components/menu-digital.utils";

/**
 * HU-046 (BL-553): sugerencia de complementos en el detalle del pedido.
 * Funciones puras (con test) y la regla «una vez por pedido».
 */

/** De dónde sale la sugerencia (lo decide la API, BL-552). */
export type OrigenComplementos = "reglas" | "popularidad" | "ninguno";

export interface PlatoSugerido {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion: string | null;
  readonly precio: string | number;
  readonly imagenUrl: string | null;
}

export interface RespuestaComplementos {
  readonly origen: OrigenComplementos;
  readonly sugerencias: readonly PlatoSugerido[];
}

export const MAXIMO_SUGERENCIAS = 2;
export const TITULO_COMPLEMENTOS = "¿Querés sumar algo?";
export const ID_TITULO_COMPLEMENTOS = "titulo-complementos";

/** El texto que explica por qué se sugiere. */
export function explicacionComplementos(origen: OrigenComplementos): string {
  return origen === "popularidad"
    ? "Es de lo más pedido del local"
    : "Suele pedirse junto con lo que elegiste";
}

/**
 * La ruta del endpoint según cómo se abrió la carta. Con el link de pago
 * (el pedido ya está hecho) no hay sugerencia.
 */
export function rutaComplementos(origen: OrigenMenu): string | null {
  if (origen.tipo === "mesa") {
    return `/menu/qr/${encodeURIComponent(origen.qrToken)}/complementos`;
  }
  if (origen.tipo === "publico") {
    return `/menu/tenant/${origen.tenantId}/restaurante/${origen.restauranteId}/complementos`;
  }
  return null;
}

/** Los ids distintos de los platos del pedido, en orden. */
export function idsDelPedido(
  lineas: readonly { readonly itemCartaId: string }[],
): string[] {
  return [...new Set(lineas.map((l) => l.itemCartaId))];
}

function esPlatoSugerido(valor: unknown): valor is PlatoSugerido {
  if (typeof valor !== "object" || valor === null) return false;
  const p = valor as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.nombre === "string" &&
    (typeof p.precio === "string" || typeof p.precio === "number")
  );
}

/**
 * La respuesta de la API, o null si no tiene la forma esperada (una API
 * anterior o un error): en ese caso no se muestra nada.
 */
export function respuestaDeComplementos(
  cuerpo: unknown,
): RespuestaComplementos | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const { origen, sugerencias } = cuerpo as Record<string, unknown>;
  if (
    (origen !== "reglas" && origen !== "popularidad" && origen !== "ninguno") ||
    !Array.isArray(sugerencias)
  ) {
    return null;
  }
  return {
    origen,
    sugerencias: sugerencias.filter(esPlatoSugerido).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion ?? null,
      precio: p.precio,
      imagenUrl: p.imagenUrl ?? null,
    })),
  };
}

/**
 * Estado de la sugerencia en un pedido:
 * - «pendiente»: todavía no se pidió.
 * - «pedida»: se pidió (`respuesta` es null mientras llega, o si falló).
 * - «resuelta»: el comensal agregó un plato o eligió «No, gracias». No
 *   vuelve a aparecer en este pedido, aunque cierre y abra la hoja.
 *
 * `pedido` cuenta los pedidos: se suma al reiniciar (carrito vacío o pago
 * aprobado), y así una respuesta que llega tarde, de un pedido anterior, se
 * descarta.
 */
export interface EstadoSugerencia {
  readonly fase: "pendiente" | "pedida" | "resuelta";
  readonly pedido: number;
  readonly respuesta: RespuestaComplementos | null;
}

export type AccionSugerencia =
  | { readonly tipo: "pedir" }
  | {
      readonly tipo: "recibir";
      readonly pedido: number;
      readonly respuesta: RespuestaComplementos | null;
    }
  | { readonly tipo: "resolver" }
  | { readonly tipo: "reiniciar" };

export const ESTADO_INICIAL_SUGERENCIA: EstadoSugerencia = {
  fase: "pendiente",
  pedido: 0,
  respuesta: null,
};

export function siguienteEstadoSugerencia(
  estado: EstadoSugerencia,
  accion: AccionSugerencia,
): EstadoSugerencia {
  switch (accion.tipo) {
    case "pedir":
      return estado.fase === "pendiente"
        ? { ...estado, fase: "pedida", respuesta: null }
        : estado;
    case "recibir":
      return estado.fase === "pedida" && accion.pedido === estado.pedido
        ? { ...estado, respuesta: accion.respuesta }
        : estado;
    case "resolver":
      return { ...estado, fase: "resuelta", respuesta: null };
    case "reiniciar":
      return estado.fase === "pendiente" && estado.respuesta === null
        ? estado
        : { fase: "pendiente", pedido: estado.pedido + 1, respuesta: null };
  }
}

/**
 * Los platos que se muestran: hasta 2, sin los que ya están en el pedido
 * (el comensal pudo agregarlos desde la carta después de pedir la
 * sugerencia). Si el pedido está resuelto, ninguno.
 */
export function sugerenciasVisibles(
  estado: EstadoSugerencia,
  lineas: readonly { readonly itemCartaId: string }[],
): readonly PlatoSugerido[] {
  if (estado.fase !== "pedida" || !estado.respuesta) return [];
  const enPedido = new Set(idsDelPedido(lineas));
  return estado.respuesta.sugerencias
    .filter((p) => !enPedido.has(p.id))
    .slice(0, MAXIMO_SUGERENCIAS);
}
