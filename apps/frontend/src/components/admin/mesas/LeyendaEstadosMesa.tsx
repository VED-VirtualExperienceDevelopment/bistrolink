import { ESTADOS_MESA_VALIDOS } from "@/types/mesa";
import {
  BORDE_POR_ESTADO,
  COLOR_POR_ESTADO,
  ETIQUETA_POR_ESTADO,
} from "./mapa-mesas.utils";

// Mismo color de borde que MesaShape (on-surface-variant).
const COLOR_BORDE = "#494551";

/**
 * HU-028 (BL-173): referencia de los estados de mesa del mapa. Cada muestra
 * repite el color de relleno Y el patrón del borde de la mesa, y lleva el
 * nombre del estado en texto: así el estado no depende solo del color, y un
 * lector de pantalla lee la lista (el lienzo de Konva no es accesible).
 */
export function LeyendaEstadosMesa() {
  return (
    <section aria-labelledby="leyenda-estados-mesa">
      <h3 id="leyenda-estados-mesa" className="sr-only">
        Estados de las mesas
      </h3>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {ESTADOS_MESA_VALIDOS.map((estado) => (
          <li
            key={estado}
            className="flex items-center gap-2 text-label-md text-on-surface-variant"
          >
            <svg
              aria-hidden="true"
              width="22"
              height="22"
              viewBox="0 0 22 22"
            >
              <circle
                cx="11"
                cy="11"
                r="9"
                fill={COLOR_POR_ESTADO[estado]}
                stroke={COLOR_BORDE}
                strokeWidth="2.5"
                strokeDasharray={BORDE_POR_ESTADO[estado].join(" ") || undefined}
              />
            </svg>
            <span>{ETIQUETA_POR_ESTADO[estado]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
