"use client";

import type { EstablecimientoListado } from "@/types/plataforma";
import {
  describirCreadoPor,
  etiquetaPlan,
  formatearFechaAlta,
} from "./plataforma.utils";

interface Props {
  establecimientos: EstablecimientoListado[];
}

// BL-405: en PC y tablet, columnas alineadas (establecimiento, restaurante,
// plan, alta); en el celular, cada establecimiento es una tarjeta de una sola
// columna, sin desplazamiento horizontal. Mismo patrón que UsuariosTable
// (BL-364): cada fila es su propia grilla con las mismas columnas.
const COLUMNAS =
  "md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem_minmax(0,1fr)] md:items-center md:gap-4";

/**
 * BL-163 (HU-027): establecimientos dados de alta, del más reciente al más
 * viejo.
 *
 * BL-405: lista con filas en grilla en lugar de <table>, para que en el
 * celular cada establecimiento sea una tarjeta. Los rótulos («Restaurante»,
 * «Plan», «Alta») se ven en el celular y en PC quedan solo para el lector de
 * pantalla (el encabezado de columnas es decorativo), así cada dato se
 * entiende solo en cualquier ancho.
 */
export function EstablecimientosTable({ establecimientos }: Readonly<Props>) {
  if (establecimientos.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
        <span
          className="material-symbols-outlined text-4xl text-on-surface-variant"
          aria-hidden="true"
        >
          storefront
        </span>
        <p className="mt-2 text-body-lg text-on-surface">
          Todavía no hay establecimientos
        </p>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Usá &ldquo;Nuevo establecimiento&rdquo; para dar de alta el primero.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
      {/* Encabezado de columnas, solo en PC y tablet. Es decorativo: cada
          dato de la fila lleva su propio rótulo para el lector de pantalla. */}
      <div
        aria-hidden="true"
        className={`hidden border-b border-outline-variant bg-surface-container-low px-6 py-3 text-body-md font-semibold text-on-surface-variant ${COLUMNAS}`}
      >
        <span>Establecimiento</span>
        <span>Restaurante</span>
        <span>Plan</span>
        <span>Alta</span>
      </div>

      <ul aria-label="Establecimientos" className="divide-y divide-outline-variant">
        {establecimientos.map((e) => (
          <li
            key={e.tenantId}
            className={`flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-surface-container-low md:px-6 ${COLUMNAS}`}
          >
            {/* Establecimiento: razón social y RUT. */}
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-surface-container">
                <span
                  className="material-symbols-outlined text-primary"
                  aria-hidden="true"
                >
                  storefront
                </span>
              </div>
              <div className="min-w-0">
                <p className="break-words text-body-lg font-semibold text-on-surface">
                  {e.razonSocial}
                </p>
                <p className="break-all text-body-md text-on-surface-variant">
                  RUT {e.rut}
                </p>
              </div>
            </div>

            {/* Restaurante. «Sin restaurante» se mejora en BL-407 (texto e
                ícono, y la acción para completar el alta). */}
            <p className="min-w-0 break-words text-body-md text-on-surface">
              <span className="text-on-surface-variant md:sr-only">
                Restaurante:{" "}
              </span>
              {e.restaurante ? (
                e.restaurante.nombre
              ) : (
                <span
                  className="text-error"
                  title="El alta quedó a medias: volver a darlo de alta completa lo que falta"
                >
                  Sin restaurante
                </span>
              )}
            </p>

            {/* Plan, con su nombre para personas («Básico», no «BASICO»). */}
            <p className="text-body-md">
              <span className="text-on-surface-variant md:sr-only">Plan: </span>
              <span className="inline-flex rounded-full bg-secondary-container px-3 py-1 text-body-md text-on-secondary-container">
                {etiquetaPlan(e.plan)}
              </span>
            </p>

            {/* Alta: fecha y quién la hizo. */}
            <div className="min-w-0 text-body-md text-on-surface-variant">
              <p>
                <span className="md:sr-only">Alta: </span>
                <time dateTime={e.creadoEl} className="whitespace-nowrap">
                  {formatearFechaAlta(e.creadoEl)}
                </time>
              </p>
              <p className="break-words">
                <span className="sr-only">Dado de alta por </span>
                {describirCreadoPor(e.creadoPor)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
