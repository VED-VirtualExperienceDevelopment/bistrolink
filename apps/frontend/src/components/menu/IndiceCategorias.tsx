'use client';

import type { CategoriaGestion } from './gestion-carta.utils';

interface Props {
  readonly categorias: readonly CategoriaGestion[];
  /** «chips»: fila desplazable (celular y tablet); «lista»: columna (PC). */
  readonly variante: 'chips' | 'lista';
}

/**
 * BL-400: el índice aparece desde esta cantidad de categorías a la vista.
 * Con menos, repite lo que ya se ve (los títulos y el filtro «Categoría») y
 * suma ruido.
 */
export const MINIMO_CATEGORIAS_INDICE = 6;

/** Id de la sección de cada categoría en la página. */
export const idSeccionCategoria = (categoriaId: string) =>
  `seccion-${categoriaId}`;
/** Id del título de cada categoría (recibe el foco al saltar). */
export const idTituloCategoria = (categoriaId: string) =>
  `categoria-${categoriaId}`;

/**
 * BL-400: índice de categorías para saltar a cada una sin recorrer toda la
 * carta. En el celular y la tablet es una fila de chips desplazable, dentro
 * de la barra fija; en PC, una columna fija a la izquierda.
 *
 * Al elegir una categoría, la página se desplaza hasta ella y el foco pasa a
 * su título, así el lector de pantalla y el teclado siguen desde ahí.
 */
export function IndiceCategorias({ categorias, variante }: Props) {
  const irA = (categoriaId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document
      .getElementById(idSeccionCategoria(categoriaId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document
      .getElementById(idTituloCategoria(categoriaId))
      ?.focus({ preventScroll: true });
  };

  if (variante === 'chips') {
    return (
      <nav aria-label="Ir a una categoría">
        <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {categorias.map((cat) => (
            <li key={cat.id} className="flex-none">
              <a
                href={`#${idSeccionCategoria(cat.id)}`}
                onClick={irA(cat.id)}
                className="flex min-h-12 items-center rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-body-md text-on-surface hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {cat.nombre}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Ir a una categoría">
      <p className="mb-2 text-label-md text-on-surface-variant">Categorías</p>
      <ul className="space-y-1">
        {categorias.map((cat) => (
          <li key={cat.id}>
            <a
              href={`#${idSeccionCategoria(cat.id)}`}
              onClick={irA(cat.id)}
              className="flex min-h-12 items-center justify-between gap-2 rounded-lg px-3 text-body-md text-on-surface hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span className="truncate">{cat.nombre}</span>
              <span className="flex-none text-body-sm text-on-surface-variant">
                {cat.items.length}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
