"use client";

import type { Ref } from "react";
import { MAX_LARGO_BUSQUEDA } from "./plataforma.utils";

interface Props {
  valor: string;
  onChange: (valor: string) => void;
  /** Para devolver el foco al campo después de «Limpiar búsqueda». */
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * BL-406: búsqueda de establecimientos por razón social o RUT. Mismo diseño
 * que FiltrosUsuarios (BL-363): etiqueta visible, control de 48 px y
 * role="search". La búsqueda se aplica mientras se escribe (la página espera
 * a que se deje de tipear antes de pedirla al servidor).
 *
 * El filtro por estado (Activos, Suspendidos, Alta incompleta) se suma con
 * BL-410, que agrega al tenant los datos para filtrarlo sin saltear el RLS
 * de `restaurante`.
 */
export function BuscarEstablecimientos({
  valor,
  onChange,
  inputRef,
}: Readonly<Props>) {
  return (
    <form
      role="search"
      aria-label="Buscar establecimientos"
      onSubmit={(e) => e.preventDefault()}
      className="max-w-xl"
    >
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
          className="min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest pl-10 pr-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
      <p
        id="establecimientos-busqueda-ayuda"
        className="mt-1 text-body-md text-on-surface-variant"
      >
        El RUT se puede escribir con o sin puntos y guiones.
      </p>
    </form>
  );
}
