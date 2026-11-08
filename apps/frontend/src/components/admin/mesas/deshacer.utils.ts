// BL-332: deshacer la última eliminación del editor del plano. Lógica pura,
// sin React ni Konva, para poder testearla en entorno node.
import type { ElementoPlano, ZonaPlano } from "@/types/plano";
import type { MesaEnEdicion } from "./mapa-mesas.utils";

/**
 * Cuánto tiempo queda disponible «Deshacer» después de eliminar. Mientras
 * el aviso tiene el foco o el puntero encima, no se cierra (WCAG 2.2.1).
 */
export const DURACION_DESHACER_MS = 8000;

/** Lo último que se eliminó, con su posición en la lista para devolverlo ahí. */
export type Eliminacion =
  | { tipo: "mesa"; mesa: MesaEnEdicion; indice: number }
  | { tipo: "zona"; zona: ZonaPlano; indice: number }
  | {
      tipo: "elemento";
      elemento: ElementoPlano;
      indice: number;
      /** Nombre del tipo de elemento («Puerta», «Caja»…). */
      etiqueta: string;
    };

/** Texto del aviso: «Mesa 4 eliminada», «Zona «Terraza» eliminada»… */
export function textoEliminacion(eliminacion: Eliminacion): string {
  switch (eliminacion.tipo) {
    case "mesa":
      return `Mesa ${eliminacion.mesa.numero} eliminada`;
    case "zona":
      return `Zona «${eliminacion.zona.etiqueta}» eliminada`;
    case "elemento":
      return `Elemento «${eliminacion.etiqueta}» eliminado`;
  }
}

/** Inserta `item` en la posición `indice` (acotada al largo de la lista). */
export function reinsertar<T>(
  lista: readonly T[],
  item: T,
  indice: number,
): T[] {
  const posicion = Math.min(Math.max(indice, 0), lista.length);
  return [...lista.slice(0, posicion), item, ...lista.slice(posicion)];
}

/**
 * Devuelve una mesa eliminada a su lugar y la saca de las eliminadas
 * pendientes de guardar. Solo toca esa mesa: los cambios hechos después de
 * eliminarla (mover otra mesa, por ejemplo) se mantienen.
 */
export function restaurarMesa(
  mesas: MesaEnEdicion[],
  eliminadas: MesaEnEdicion[],
  mesa: MesaEnEdicion,
  indice: number,
): { mesas: MesaEnEdicion[]; eliminadas: MesaEnEdicion[] } {
  if (mesas.some((m) => m.clientId === mesa.clientId)) {
    return { mesas, eliminadas };
  }
  return {
    mesas: reinsertar(mesas, mesa, indice),
    eliminadas: eliminadas.filter((m) => m.clientId !== mesa.clientId),
  };
}

/** Devuelve una zona o un elemento eliminado a su lugar, si no volvió ya. */
export function restaurarPorId<T extends { id: string }>(
  lista: T[],
  item: T,
  indice: number,
): T[] {
  if (lista.some((x) => x.id === item.id)) return lista;
  return reinsertar(lista, item, indice);
}
