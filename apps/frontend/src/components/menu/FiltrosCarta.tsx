'use client';

import type {
  CategoriaGestion,
  FiltroEstadoCarta,
  FiltrosCarta as Filtros,
} from './gestion-carta.utils';

interface Props {
  readonly filtros: Filtros;
  readonly onChange: (filtros: Filtros) => void;
  readonly categorias: readonly CategoriaGestion[];
}

const OPCIONES_ESTADO: { valor: FiltroEstadoCarta; texto: string }[] = [
  { valor: 'TODOS', texto: 'Todos' },
  { valor: 'DISPONIBLES', texto: 'Disponibles' },
  { valor: 'AGOTADOS', texto: 'Agotados' },
  { valor: 'OCULTOS', texto: 'En categorías ocultas' },
];

// Mismos controles que los filtros de Usuarios (BL-363): 48 px y etiqueta
// visible.
const CLASE_CONTROL =
  'min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

/**
 * BL-398 (parte 2): búsqueda y filtros de Gestión de Carta, con el mismo
 * diseño que los de Usuarios. El filtrado se aplica mientras se escribe,
 * sin botón de enviar (role="search").
 */
export function FiltrosCarta({ filtros, onChange, categorias }: Props) {
  return (
    <form
      role="search"
      aria-label="Buscar y filtrar la carta"
      onSubmit={(e) => e.preventDefault()}
      className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div>
        <label htmlFor="carta-busqueda" className="mb-1 block text-label-md text-on-surface-variant">
          Buscar
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
          >
            search
          </span>
          <input
            id="carta-busqueda"
            type="search"
            autoComplete="off"
            placeholder="Nombre del ítem o de la categoría"
            value={filtros.busqueda}
            onChange={(e) => onChange({ ...filtros, busqueda: e.target.value })}
            className={`${CLASE_CONTROL} pl-10`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="carta-estado" className="mb-1 block text-label-md text-on-surface-variant">
          Estado
        </label>
        <select
          id="carta-estado"
          value={filtros.estado}
          onChange={(e) =>
            onChange({ ...filtros, estado: e.target.value as FiltroEstadoCarta })
          }
          className={CLASE_CONTROL}
        >
          {OPCIONES_ESTADO.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.texto}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="carta-categoria" className="mb-1 block text-label-md text-on-surface-variant">
          Categoría
        </label>
        <select
          id="carta-categoria"
          value={filtros.categoriaId}
          onChange={(e) => onChange({ ...filtros, categoriaId: e.target.value })}
          className={CLASE_CONTROL}
        >
          <option value="TODAS">Todas</option>
          {categorias.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.nombre}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
