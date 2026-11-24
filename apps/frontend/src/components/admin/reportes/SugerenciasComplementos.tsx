import {
  ayudaSugerencias,
  formatearPorcentaje,
  type ReporteVentas,
} from "./reportes.utils";
import {
  CLASE_AYUDA,
  CLASE_TARJETA,
  CLASE_TITULO_TARJETA,
} from "./reportes.estilos";

/**
 * HU-046 (BL-554): cuántas veces se sugirió un complemento antes de pagar y
 * cuántos platos sugeridos se pagaron, en el período y el canal elegidos.
 * Son contadores agregados: no dicen quién pidió qué. Sin el dato (un
 * backend anterior), la tarjeta no se muestra.
 */
export default function SugerenciasComplementos({
  reporte,
}: Readonly<{ reporte: ReporteVentas }>) {
  const { sugerencias, canal } = reporte;
  if (!sugerencias) return null;
  const ayuda = ayudaSugerencias(sugerencias, canal);
  const datos = [
    { etiqueta: "Mostradas", valor: String(sugerencias.mostradas) },
    { etiqueta: "Aceptadas", valor: String(sugerencias.aceptadas) },
    {
      etiqueta: "Tasa de aceptación",
      valor: `${formatearPorcentaje(sugerencias.tasaAceptacion)} %`,
    },
  ];

  return (
    <section aria-labelledby="titulo-sugerencias" className={CLASE_TARJETA}>
      <h2 id="titulo-sugerencias" className={CLASE_TITULO_TARJETA}>
        Sugerencias de complementos
      </h2>
      <p className={`mt-1 ${CLASE_AYUDA}`}>
        El postre o la bebida que se le ofrece al comensal antes de pagar:
        cuántas veces se mostró y cuántos platos sugeridos se pagaron.
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        {datos.map(({ etiqueta, valor }) => (
          <div
            key={etiqueta}
            className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-3"
          >
            <dt className="text-label-md text-on-surface-variant">
              {etiqueta}
            </dt>
            <dd className="text-headline-sm text-on-surface sm:text-headline-md">
              {valor}
            </dd>
          </div>
        ))}
      </dl>
      {ayuda && <p className={`mt-3 ${CLASE_AYUDA}`}>{ayuda}</p>}
    </section>
  );
}
