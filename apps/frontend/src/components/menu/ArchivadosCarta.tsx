'use client';

import type { ArchivarObjetivo as Objetivo } from './ArchivarDialog';
import {
  sePuedeEliminarCategoria,
  sePuedeEliminarItem,
  textoFechaArchivo,
  type CategoriaGestion,
  type ItemGestion,
} from './gestion-carta.utils';
import { formatearPrecio } from '@/components/pago/pago.utils';

interface Props {
  readonly categorias: readonly CategoriaGestion[];
  readonly onRestaurar: (objetivo: Objetivo) => void;
  readonly onEliminar: (objetivo: Objetivo) => void;
}

const CLASE_BOTON =
  'flex min-h-12 items-center gap-1 rounded-lg px-3 text-body-md font-medium hover:bg-surface-container-high';

function Acciones({
  objetivo,
  sePuedeEliminar,
  onRestaurar,
  onEliminar,
}: {
  readonly objetivo: Objetivo;
  readonly sePuedeEliminar: boolean;
  readonly onRestaurar: (objetivo: Objetivo) => void;
  readonly onEliminar: (objetivo: Objetivo) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        onClick={() => onRestaurar(objetivo)}
        className={`${CLASE_BOTON} text-primary`}
        aria-label={`Restaurar ${objetivo.nombre}`}
      >
        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
          unarchive
        </span>
        Restaurar
      </button>
      {/* BL-394: eliminar solo se ofrece si no hay historial; si no, no se
          muestra (y la API igual respondería 409). */}
      {sePuedeEliminar && (
        <button
          type="button"
          onClick={() => onEliminar(objetivo)}
          className={`${CLASE_BOTON} text-error`}
          aria-label={`Eliminar ${objetivo.nombre} definitivamente`}
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            delete
          </span>
          Eliminar
        </button>
      )}
    </div>
  );
}

function ItemArchivado({
  item,
  onRestaurar,
  onEliminar,
  categoriaArchivada,
}: {
  readonly item: ItemGestion;
  readonly onRestaurar: (objetivo: Objetivo) => void;
  readonly onEliminar: (objetivo: Objetivo) => void;
  readonly categoriaArchivada: boolean;
}) {
  const fecha = textoFechaArchivo(item.archivadoEn, 'o');
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="text-body-lg font-medium text-on-surface-variant">
          {item.nombre}
        </p>
        <p className="text-body-md text-on-surface-variant">
          {formatearPrecio(item.precio)}
          {fecha && ` · ${fecha}`}
          {item.tieneHistorial && ' · Tiene pedidos'}
        </p>
      </div>
      {/* Los ítems de una categoría archivada se restauran después de
          restaurar la categoría (la API lo exige). */}
      {categoriaArchivada ? (
        <p className="text-body-sm text-on-surface-variant">
          Restaurá primero la categoría
        </p>
      ) : (
        <Acciones
          objetivo={{ tipo: 'item', id: item.id, nombre: item.nombre }}
          sePuedeEliminar={sePuedeEliminarItem(item)}
          onRestaurar={onRestaurar}
          onEliminar={onEliminar}
        />
      )}
    </li>
  );
}

/**
 * BL-398 (parte 3): lo archivado de la carta, con «Restaurar» y, si no tiene
 * historial, «Eliminar definitivamente». En gris, aparte de la carta activa.
 */
export function ArchivadosCarta({ categorias, onRestaurar, onEliminar }: Props) {
  if (categorias.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant" aria-hidden="true">
          inventory_2
        </span>
        <p className="mt-2 text-body-lg text-on-surface">No hay nada archivado</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {categorias.map((cat) => {
        const fecha = textoFechaArchivo(cat.archivadaEn, 'a');
        const categoriaArchivada = Boolean(cat.archivadaEn);
        return (
          <section
            key={cat.id}
            aria-labelledby={`archivada-${cat.id}`}
            className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container"
          >
            <div className="flex flex-col gap-2 border-b border-outline-variant px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 id={`archivada-${cat.id}`} className="text-headline-sm text-on-surface-variant">
                  {cat.nombre}
                </h2>
                <p className="text-body-md text-on-surface-variant">
                  {categoriaArchivada
                    ? (fecha ?? 'Categoría archivada')
                    : 'Categoría activa, con ítems archivados'}
                </p>
              </div>
              {categoriaArchivada && (
                <Acciones
                  objetivo={{ tipo: 'categoria', id: cat.id, nombre: cat.nombre }}
                  sePuedeEliminar={sePuedeEliminarCategoria(cat)}
                  onRestaurar={onRestaurar}
                  onEliminar={onEliminar}
                />
              )}
            </div>
            {cat.items.length > 0 && (
              <ul className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
                {cat.items.map((item) => (
                  <ItemArchivado
                    key={item.id}
                    item={item}
                    onRestaurar={onRestaurar}
                    onEliminar={onEliminar}
                    categoriaArchivada={categoriaArchivada}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}