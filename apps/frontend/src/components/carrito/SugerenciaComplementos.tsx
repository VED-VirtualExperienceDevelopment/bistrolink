"use client";

import ItemImagen from "@/components/menu/ItemImagen";
import { formatearPrecio } from "@/components/pago/pago.utils";
import {
  explicacionComplementos,
  ID_TITULO_COMPLEMENTOS,
  TITULO_COMPLEMENTOS,
  type OrigenComplementos,
  type PlatoSugerido,
} from "./complementos.utils";

export interface PropsComplementos {
  readonly origen: OrigenComplementos;
  readonly platos: readonly PlatoSugerido[];
  readonly onAgregar: (plato: PlatoSugerido) => void;
  readonly onRechazar: () => void;
}

/**
 * HU-046 (BL-553): «¿Querés sumar algo?» en el detalle del pedido, arriba
 * del total. Hasta 2 platos con foto, nombre, precio y «Agregar», y «No,
 * gracias» a la vista. Nada viene marcado: si el comensal no toca nada, el
 * pedido sigue igual.
 *
 * Accesible: sección con título (h3 en la hoja, h4 en la columna, debajo
 * del título del pedido), botones de 44 px de alto con el nombre del plato
 * y la foto decorativa (el nombre ya está al lado).
 */
export function SugerenciaComplementos({
  origen,
  platos,
  onAgregar,
  onRechazar,
  nivelTitulo,
  deshabilitado,
}: PropsComplementos & {
  readonly nivelTitulo: "h3" | "h4";
  readonly deshabilitado: boolean;
}) {
  if (platos.length === 0) return null;
  const Titulo = nivelTitulo;
  return (
    <section
      aria-labelledby={ID_TITULO_COMPLEMENTOS}
      className="rounded-lg border border-marca/25 bg-marca/5 p-3"
    >
      <Titulo
        id={ID_TITULO_COMPLEMENTOS}
        className="text-base font-bold text-foreground"
      >
        {TITULO_COMPLEMENTOS}
      </Titulo>
      <p className="mt-0.5 text-xs text-[#5a575e]">
        {explicacionComplementos(origen)}
      </p>
      <ul className="mt-3 space-y-2">
        {platos.map((plato) => (
          <li
            key={plato.id}
            className="flex items-center gap-3 rounded-lg bg-white p-2"
          >
            <div className="h-12 w-12 flex-none overflow-hidden rounded-md bg-culinary-background">
              <ItemImagen
                url={plato.imagenUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {plato.nombre}
              </p>
              <p className="text-sm text-[#5a575e]">
                {formatearPrecio(Number(plato.precio))}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onAgregar(plato)}
              disabled={deshabilitado}
              aria-label={`Agregar ${plato.nombre} al pedido`}
              className="h-11 flex-none rounded-full border-2 border-marca px-4 text-sm font-bold text-marca hover:bg-marca/10 focus:outline-none focus:ring-4 focus:ring-marca/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Agregar
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onRechazar}
        disabled={deshabilitado}
        className="mt-2 h-11 w-full rounded-lg text-sm font-semibold text-[#5a575e] hover:bg-culinary-neutral/10 focus:outline-none focus:ring-4 focus:ring-marca/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        No, gracias
      </button>
    </section>
  );
}
