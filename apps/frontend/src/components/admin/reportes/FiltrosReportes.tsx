"use client";

import {
  CANALES,
  PERIODOS,
  type FiltrosReportes as Filtros,
} from "./reportes.utils";
import { CLASE_AYUDA, claseChip } from "./reportes.estilos";

const CLASE_LEYENDA = "mb-2 text-label-md text-on-surface-variant";
const CLASE_FECHA =
  "min-h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-error";

/**
 * HU-012 (BL-108): filtros del dashboard. Cada grupo es un fieldset con su
 * leyenda; las opciones son radios (se eligen con las flechas del teclado)
 * con forma de chip.
 */
export default function FiltrosReportes({
  filtros,
  invalido,
  onCambiar,
}: Readonly<{
  filtros: Filtros;
  invalido: boolean;
  onCambiar: (filtros: Filtros) => void;
}>) {
  return (
    <form
      role="search"
      aria-label="Filtrar los reportes"
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
    >
      <fieldset>
        <legend className={CLASE_LEYENDA}>Período</legend>
        <div className="flex flex-wrap gap-2">
          {PERIODOS.map(({ valor, etiqueta }) => (
            <label key={valor} className={claseChip(filtros.periodo === valor)}>
              <input
                type="radio"
                name="periodo"
                value={valor}
                checked={filtros.periodo === valor}
                onChange={() => onCambiar({ ...filtros, periodo: valor })}
                className="sr-only"
              />
              {etiqueta}
            </label>
          ))}
        </div>
        {filtros.periodo === "PERSONALIZADO" && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="reportes-desde"
                className="mb-1 block text-label-md text-on-surface-variant"
              >
                Desde
              </label>
              <input
                id="reportes-desde"
                type="date"
                value={filtros.desde}
                onChange={(e) =>
                  onCambiar({ ...filtros, desde: e.target.value })
                }
                aria-invalid={invalido}
                aria-describedby={invalido ? "reportes-rango" : undefined}
                className={CLASE_FECHA}
              />
            </div>
            <div>
              <label
                htmlFor="reportes-hasta"
                className="mb-1 block text-label-md text-on-surface-variant"
              >
                Hasta
              </label>
              <input
                id="reportes-hasta"
                type="date"
                value={filtros.hasta}
                onChange={(e) =>
                  onCambiar({ ...filtros, hasta: e.target.value })
                }
                aria-invalid={invalido}
                aria-describedby={invalido ? "reportes-rango" : undefined}
                className={CLASE_FECHA}
              />
            </div>
            {invalido && (
              <p
                id="reportes-rango"
                role="alert"
                className="text-body-sm text-error"
              >
                Elegí las dos fechas, con «desde» igual o anterior a «hasta».
              </p>
            )}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className={CLASE_LEYENDA}>Canal de venta</legend>
        <div className="flex flex-wrap gap-2">
          {CANALES.map(({ valor, etiqueta, descripcion, proximamente }) => (
            <label
              key={valor}
              title={descripcion}
              className={claseChip(filtros.canal === valor, proximamente)}
            >
              <input
                type="radio"
                name="canal"
                value={valor}
                checked={filtros.canal === valor}
                disabled={proximamente}
                aria-describedby={`canal-${valor}-ayuda`}
                onChange={() => onCambiar({ ...filtros, canal: valor })}
                className="sr-only"
              />
              {etiqueta}
              {proximamente && (
                <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-label-sm text-on-surface-variant">
                  Próximamente
                </span>
              )}
              <span id={`canal-${valor}-ayuda`} className="sr-only">
                {descripcion}
              </span>
            </label>
          ))}
        </div>
        <p className={`mt-2 ${CLASE_AYUDA}`}>
          En el local: QR de la mesa y mozo. Web: pedidos para retirar.
        </p>
      </fieldset>
    </form>
  );
}
