"use client";

import { useState } from "react";
import {
  formatearMonto,
  largoBarra,
  MENSAJE_PLATOS_POS,
  platosSegun,
  type MetricaPlatos,
  type ReporteVentas,
} from "./reportes.utils";
import {
  CLASE_AYUDA,
  CLASE_ENLACE,
  CLASE_TARJETA,
  CLASE_TITULO_TARJETA,
} from "./reportes.estilos";
import SelectorMetrica from "./SelectorMetrica";
import TablaAccesible from "./TablaAccesible";

const METRICAS = [
  { valor: "cantidad", etiqueta: "Cantidad" },
  { valor: "recaudado", etiqueta: "Recaudado" },
] as const;

/** HU-012 (BL-108): top 10 de platos, por cantidad o por recaudado. */
export default function PlatosMasPedidos({
  reporte,
}: Readonly<{ reporte: ReporteVentas }>) {
  const [metrica, setMetrica] = useState<MetricaPlatos>("cantidad");
  const [verTabla, setVerTabla] = useState(false);
  const platos = platosSegun(reporte, metrica);
  const maximo = platos[0]?.[metrica] ?? 0;

  return (
    <section aria-labelledby="titulo-platos" className={CLASE_TARJETA}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titulo-platos" className={CLASE_TITULO_TARJETA}>
          Platos más pedidos
        </h2>
        <SelectorMetrica
          nombre="metrica-platos"
          leyenda="Ordenar los platos por"
          opciones={METRICAS}
          valor={metrica}
          onCambiar={setMetrica}
        />
      </div>

      {platos.length === 0 ? (
        <p className={`mt-6 ${CLASE_AYUDA}`}>
          {reporte.canal === "POS"
            ? MENSAJE_PLATOS_POS
            : "Todavía no hay ventas en este período."}
        </p>
      ) : (
        <>
          <ol aria-hidden="true" className="mt-4 space-y-3">
            {platos.map((plato) => (
              <li
                key={plato.itemCartaId}
                className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-body-md sm:grid-cols-[minmax(0,14rem)_1fr_auto]"
              >
                <span className="truncate text-on-surface" title={plato.nombre}>
                  {plato.nombre}
                </span>
                <span className="h-3 overflow-hidden rounded-full bg-surface-container-high">
                  <span
                    className="block h-full rounded-full bg-surface-tint transition-[width] duration-500"
                    style={{ width: `${largoBarra(plato[metrica], maximo)}%` }}
                  />
                </span>
                <span className="text-right text-on-surface-variant">
                  {metrica === "cantidad"
                    ? `${plato.cantidad} u.`
                    : formatearMonto(plato.recaudado)}
                </span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setVerTabla(!verTabla)}
            aria-expanded={verTabla}
            className={`mt-3 ${CLASE_ENLACE}`}
          >
            {verTabla ? "Ocultar la tabla" : "Ver como tabla"}
          </button>
        </>
      )}
      <TablaAccesible
        titulo="Platos más pedidos"
        columnas={["Plato", "Cantidad", "Recaudado"]}
        filas={platos.map((p) => [
          p.nombre,
          `${p.cantidad}`,
          formatearMonto(p.recaudado),
        ])}
        visible={verTabla}
      />
    </section>
  );
}
