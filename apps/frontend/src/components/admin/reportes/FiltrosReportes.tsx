"use client";

import { Fragment } from "react";
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
 * con forma de chip. HU-050 (BL-558): las valoraciones usan solo el período
 * (`conCanal={false}`), con su propia etiqueta.
 */
export default function FiltrosReportes({
  filtros,
  invalido,
  onCambiar,
  etiqueta = "Filtrar los reportes",
  conCanal = true,
}: Readonly<{
  filtros: Filtros;
  invalido: boolean;
  onCambiar: (filtros: Filtros) => void;
  etiqueta?: string;
  conCanal?: boolean;
}>) {
  return (
    <form
      role="search"
      aria-label={etiqueta}
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

      {conCanal && (
        <fieldset>
          <legend className={CLASE_LEYENDA}>Canal de venta</legend>
          <div className="flex flex-wrap gap-2">
            {CANALES.map(({ valor, etiqueta, descripcion }) => (
              // La descripción va afuera del label: así el nombre accesible del
              // radio es solo el canal («Web») y la descripción se lee aparte.
              <Fragment key={valor}>
                <label
                  title={descripcion}
                  className={claseChip(filtros.canal === valor)}
                >
                  <input
                    type="radio"
                    name="canal"
                    value={valor}
                    checked={filtros.canal === valor}
                    aria-describedby={`canal-${valor}-ayuda`}
                    onChange={() => onCambiar({ ...filtros, canal: valor })}
                    className="sr-only"
                  />
                  {etiqueta}
                </label>
                <span id={`canal-${valor}-ayuda`} className="sr-only">
                  {descripcion}
                </span>
              </Fragment>
            ))}
          </div>
          <p className={`mt-2 ${CLASE_AYUDA}`}>
            En el local: QR de la mesa y mozo. Web: pedidos para retirar.
            WhatsApp: pedidos para retirar hechos por el bot.
          </p>
        </fieldset>
      )}
    </form>
  );
}
