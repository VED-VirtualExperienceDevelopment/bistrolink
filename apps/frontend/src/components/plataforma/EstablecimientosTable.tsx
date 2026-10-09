'use client';

import type { EstablecimientoListado } from '@/types/plataforma';
import { describirCreadoPor, formatearFechaAlta } from './plataforma.utils';

interface Props {
  establecimientos: EstablecimientoListado[];
}

/** BL-163 (HU-027): establecimientos dados de alta, del más reciente al más viejo. */
export function EstablecimientosTable({ establecimientos }: Props) {
  if (establecimientos.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant" aria-hidden="true">
          storefront
        </span>
        <p className="mt-2 text-body-lg text-on-surface">Todavía no hay establecimientos</p>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Usá &ldquo;Nuevo establecimiento&rdquo; para dar de alta el primero.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
      <table className="w-full text-left">
        <thead className="border-b border-outline-variant bg-surface-container-low">
          <tr className="text-label-md text-on-surface-variant">
            <th scope="col" className="px-6 py-3 font-semibold">Establecimiento</th>
            <th scope="col" className="px-6 py-3 font-semibold">Restaurante</th>
            <th scope="col" className="px-6 py-3 font-semibold">Plan</th>
            <th scope="col" className="px-6 py-3 font-semibold">Alta</th>
            <th scope="col" className="px-6 py-3 font-semibold">Dado de alta por</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {establecimientos.map((e) => (
            <tr key={e.tenantId} className="transition-colors hover:bg-surface-container-low">
              <td className="px-6 py-4">
                <p className="text-body-md font-semibold text-on-surface">{e.razonSocial}</p>
                <p className="text-body-sm text-on-surface-variant">RUT {e.rut}</p>
              </td>
              <td className="px-6 py-4 text-body-md text-on-surface">
                {e.restaurante ? (
                  e.restaurante.nombre
                ) : (
                  <span className="text-error" title="El alta quedó a medias: volver a darlo de alta completa lo que falta">
                    Sin restaurante
                  </span>
                )}
              </td>
              <td className="px-6 py-4">
                <span className="inline-flex rounded-full bg-secondary-container px-2.5 py-1 text-label-sm text-on-secondary-container">
                  {e.plan}
                </span>
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-body-md text-on-surface-variant">
                {formatearFechaAlta(e.creadoEl)}
              </td>
              <td className="px-6 py-4 text-body-md text-on-surface-variant">
                {describirCreadoPor(e.creadoPor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
