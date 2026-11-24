"use client";

import { useState } from "react";
import {
  formatearHora,
  formatearMonto,
  horaPico,
  horasDelGrafico,
  largoBarra,
  type MetricaVentas,
  type VentaPorHora,
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
  { valor: "monto", etiqueta: "Monto" },
  { valor: "pedidos", etiqueta: "Pedidos" },
] as const;

function valorDe(venta: VentaPorHora, metrica: MetricaVentas): string {
  return metrica === "monto" ? formatearMonto(venta.monto) : `${venta.pedidos}`;
}

/**
 * HU-012 (BL-108): ventas por hora del día (hora del local). Columnas
 * violeta claro y la hora pico en violeta fuerte. El gráfico es decorativo
 * para los lectores de pantalla: los datos están en la tabla.
 *
 * HU-022 (BL-496): la tabla suma las propinas de cada hora, aparte del monto.
 */
export default function VentasPorHora({
  ventas,
}: Readonly<{ ventas: VentaPorHora[] }>) {
  const [metrica, setMetrica] = useState<MetricaVentas>("monto");
  const [verTabla, setVerTabla] = useState(false);
  const horas = horasDelGrafico(ventas);
  const pico = horaPico(horas, metrica);
  const maximo = pico ? pico[metrica] : 0;

  return (
    <section aria-labelledby="titulo-ventas-hora" className={CLASE_TARJETA}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="titulo-ventas-hora" className={CLASE_TITULO_TARJETA}>
            Ventas por hora
          </h2>
          {pico && (
            <p className={CLASE_AYUDA}>
              Pico a las {formatearHora(pico.hora)} · {valorDe(pico, metrica)}
            </p>
          )}
        </div>
        <SelectorMetrica
          nombre="metrica-ventas-hora"
          leyenda="Ver las ventas por hora según"
          opciones={METRICAS}
          valor={metrica}
          onCambiar={setMetrica}
        />
      </div>

      {horas.length === 0 ? (
        <p className={`mt-6 ${CLASE_AYUDA}`}>
          Todavía no hay ventas en este período.
        </p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="mt-6 flex h-48 items-end gap-1 sm:gap-2"
          >
            {horas.map((venta) => {
              const esPico = venta.hora === pico?.hora;
              return (
                <div
                  key={venta.hora}
                  className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                >
                  <span className="pointer-events-none absolute -top-1 z-10 hidden -translate-y-full whitespace-nowrap rounded-md bg-inverse-surface px-2 py-1 text-body-sm text-inverse-on-surface group-hover:block">
                    {formatearHora(venta.hora)} · {valorDe(venta, metrica)}
                  </span>
                  <div
                    className={`w-full rounded-t-md transition-[height] duration-500 ${esPico ? "bg-primary" : "bg-primary-fixed-dim group-hover:bg-surface-tint"}`}
                    style={{ height: `${largoBarra(venta[metrica], maximo)}%` }}
                  />
                  <span className="text-label-sm text-on-surface-variant">
                    {venta.hora}
                  </span>
                </div>
              );
            })}
          </div>
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
        titulo="Ventas por hora del día"
        columnas={["Hora", "Pedidos", "Ventas", "Propinas"]}
        filas={horas.map((v) => [
          formatearHora(v.hora),
          `${v.pedidos}`,
          formatearMonto(v.monto),
          formatearMonto(v.propina),
        ])}
        visible={verTabla}
      />
    </section>
  );
}
