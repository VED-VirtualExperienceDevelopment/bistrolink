"use client";

import type { Ref } from "react";
import type { FiltroEstado } from "@/types/plataforma";
import {
  filtroEstadoDesde,
  MAX_LARGO_BUSQUEDA,
  OPCIONES_FILTRO_ESTADO,
} from "./plataforma.utils";

interface Props {
  valor: string;
  onChange: (valor: string) => void;
  /** BL-410: filtro por estado (undefined = todos). */
  estado?: FiltroEstado;
  onEstadoChange: (estado: FiltroEstado | undefined) => void;
  /** Para devolver el foco al campo después de «Limpiar búsqueda». */
  inputRef?: Ref<HTMLInputElement>;
}

const CLASE_CONTROL =
  "min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

/**
 * BL-406: búsqueda de establecimientos por razón social o RUT. Mismo diseño
 * que FiltrosUsuarios (BL-363): etiqueta visible, control de 48 px y
 * role="search". La búsqueda se aplica mientras se escribe (la página espera
 * a que se deje de tipear antes de pedirla al servidor).
 *
 * BL-410: filtro por estado (Todos, Activos, Suspendidos, Alta incompleta),
 * con un `select` nativo: se maneja con teclado y en el celular abre el
 * selector del sistema. Se aplica apenas se elige. En el celular los dos
 * controles van uno debajo del otro; desde `sm:`, en la misma fila.
 */
export function BuscarEstablecimientos({
  valor,
  onChange,
  estado,
  onEstadoChange,
  inputRef,
}: Readonly<Props>) {
  return (
    <form
      role="search"
      aria-label="Buscar y filtrar establecimientos"
      onSubmit={(e) => e.preventDefault()}
      className="flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-start"
    >
      <div className="min-w-0 flex-1">
        <label
          htmlFor="establecimientos-busqueda"
          className="mb-1 block text-label-md text-on-surface-variant"
        >
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
            ref={inputRef}
            id="establecimientos-busqueda"
            type="search"
            autoComplete="off"
            maxLength={MAX_LARGO_BUSQUEDA}
            placeholder="Razón social o RUT"
            aria-describedby="establecimientos-busqueda-ayuda"
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            className={`${CLASE_CONTROL} pl-10 pr-3`}
          />
        </div>
        <p
          id="establecimientos-busqueda-ayuda"
          className="mt-1 text-body-md text-on-surface-variant"
        >
          El RUT se puede escribir con o sin puntos y guiones.
        </p>
      </div>

      <div className="sm:w-56">
        <label
          htmlFor="establecimientos-estado"
          className="mb-1 block text-label-md text-on-surface-variant"
        >
          Estado
        </label>
        <select
          id="establecimientos-estado"
          value={estado ?? ""}
          onChange={(e) => onEstadoChange(filtroEstadoDesde(e.target.value))}
          className={`${CLASE_CONTROL} px-3`}
        >
          <option value="">Todos</option>
          {OPCIONES_FILTRO_ESTADO.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
