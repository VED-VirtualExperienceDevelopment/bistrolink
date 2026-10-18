'use client';

import type { FiltroEstado, FiltroRol, FiltrosUsuarios as Filtros } from './Usuarios.utils';

interface Props {
  filtros: Filtros;
  onChange: (filtros: Filtros) => void;
}

const OPCIONES_ROL: { valor: FiltroRol; texto: string }[] = [
  { valor: 'TODOS', texto: 'Todos' },
  { valor: 'ADMIN', texto: 'Administrador' },
  { valor: 'MOZO', texto: 'Mozo' },
  { valor: 'COCINA', texto: 'Cocina' },
];

const OPCIONES_ESTADO: { valor: FiltroEstado; texto: string }[] = [
  { valor: 'ACTIVOS', texto: 'Activos' },
  { valor: 'INACTIVOS', texto: 'Inactivos' },
  { valor: 'TODOS', texto: 'Todos' },
];

const CLASE_CONTROL =
  'min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

/**
 * BL-363: búsqueda y filtros del listado de usuarios. Controles de 48 px con
 * etiqueta visible. Es un formulario de búsqueda (role="search"): el filtrado
 * se aplica mientras se escribe, sin botón de enviar.
 */
export function FiltrosUsuarios({ filtros, onChange }: Props) {
  return (
    <form
      role="search"
      aria-label="Buscar y filtrar usuarios"
      onSubmit={(e) => e.preventDefault()}
      className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div>
        <label htmlFor="usuarios-busqueda" className="mb-1 block text-label-md text-on-surface-variant">
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
            id="usuarios-busqueda"
            type="search"
            autoComplete="off"
            placeholder="Nombre, usuario o correo"
            value={filtros.busqueda}
            onChange={(e) => onChange({ ...filtros, busqueda: e.target.value })}
            className={`${CLASE_CONTROL} pl-10`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="usuarios-rol" className="mb-1 block text-label-md text-on-surface-variant">
          Rol
        </label>
        <select
          id="usuarios-rol"
          value={filtros.rol}
          onChange={(e) => onChange({ ...filtros, rol: e.target.value as FiltroRol })}
          className={CLASE_CONTROL}
        >
          {OPCIONES_ROL.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.texto}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="usuarios-estado" className="mb-1 block text-label-md text-on-surface-variant">
          Estado
        </label>
        <select
          id="usuarios-estado"
          value={filtros.estado}
          onChange={(e) => onChange({ ...filtros, estado: e.target.value as FiltroEstado })}
          className={CLASE_CONTROL}
        >
          {OPCIONES_ESTADO.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.texto}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
