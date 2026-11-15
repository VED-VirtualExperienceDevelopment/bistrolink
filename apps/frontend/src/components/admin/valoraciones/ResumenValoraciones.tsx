import { IconoEstrella } from "@/components/valoracion/ValoracionPedido";
import {
  CLASE_AYUDA,
  CLASE_TARJETA,
  CLASE_TITULO_TARJETA,
} from "@/components/admin/reportes/reportes.estilos";
import {
  estrellasDelPromedio,
  formatearPromedio,
  porcentajeDe,
  textoCantidad,
  type ValoracionesDelPeriodo,
} from "./valoraciones.utils";

/**
 * HU-050 (BL-558): promedio del período y cuántas valoraciones hay de cada
 * cantidad de estrellas. Las barras son decorativas: cada fila dice el
 * número y el porcentaje en texto.
 */
export default function ResumenValoraciones({
  datos,
}: Readonly<{ datos: ValoracionesDelPeriodo }>) {
  const { total, promedio, distribucion } = datos;
  const llenas = estrellasDelPromedio(promedio);

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
      <section aria-labelledby="titulo-promedio" className={CLASE_TARJETA}>
        <h2 id="titulo-promedio" className={CLASE_TITULO_TARJETA}>
          Promedio
        </h2>
        {total === 0 ? (
          <p className={`mt-3 ${CLASE_AYUDA}`}>
            Todavía no hay valoraciones en este período.
          </p>
        ) : (
          <>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-5xl font-bold leading-none text-on-surface">
                {formatearPromedio(promedio)}
              </span>
              <span className="text-body-lg text-on-surface-variant">de 5</span>
            </p>
            <div aria-hidden="true" className="mt-2 flex gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <IconoEstrella key={n} llena={n <= llenas} tamano={22} />
              ))}
            </div>
            <p className={`mt-2 ${CLASE_AYUDA}`}>{textoCantidad(total)}</p>
          </>
        )}
      </section>

      <section aria-labelledby="titulo-distribucion" className={CLASE_TARJETA}>
        <h2 id="titulo-distribucion" className={CLASE_TITULO_TARJETA}>
          Por estrellas
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {distribucion.map(({ estrellas, cantidad }) => {
            const porcentaje = porcentajeDe(cantidad, total);
            return (
              <li
                key={estrellas}
                className="grid grid-cols-[4.5rem_1fr_5.5rem] items-center gap-3 text-body-md text-on-surface"
              >
                <span>
                  {estrellas} {estrellas === 1 ? "estrella" : "estrellas"}
                </span>
                <span
                  aria-hidden="true"
                  className="h-2.5 overflow-hidden rounded-full bg-surface-container-high"
                >
                  <span
                    className="block h-full rounded-full bg-[#D97706]"
                    style={{ width: `${porcentaje}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">
                  {cantidad} ({porcentaje} %)
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
