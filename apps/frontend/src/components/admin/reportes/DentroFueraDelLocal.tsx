import {
  formatearMonto,
  partesPorLugar,
  type ReporteVentas,
} from "./reportes.utils";
import {
  CLASE_AYUDA,
  CLASE_TARJETA,
  CLASE_TITULO_TARJETA,
} from "./reportes.estilos";
import TablaAccesible from "./TablaAccesible";

const COLOR: Record<string, string> = {
  local: "bg-primary",
  web: "bg-tertiary-container",
  whatsapp: "bg-outline",
  pos: "bg-secondary",
};

/**
 * HU-012 (BL-108): ventas dentro y fuera del local (D1), siempre con todos
 * los canales, y la ocupación promedio de las mesas.
 */
export default function DentroFueraDelLocal({
  reporte,
}: Readonly<{ reporte: ReporteVentas }>) {
  const partes = partesPorLugar(reporte.porLugar);
  const conVentas = partes.some((p) => p.monto > 0);
  const { rotacionMesas } = reporte;

  return (
    <section
      aria-labelledby="titulo-lugar"
      className={`${CLASE_TARJETA} flex flex-col`}
    >
      <h2 id="titulo-lugar" className={CLASE_TITULO_TARJETA}>
        Dentro y fuera del local
      </h2>
      <p className={CLASE_AYUDA}>Con todos los canales, para comparar.</p>

      <div
        aria-hidden="true"
        className="mt-4 flex h-4 overflow-hidden rounded-full bg-surface-container-high"
      >
        {conVentas &&
          partes.map((p) => (
            <div
              key={p.clave}
              className={`${COLOR[p.clave]} transition-[width] duration-500`}
              style={{ width: `${p.porcentaje}%` }}
            />
          ))}
      </div>

      <ul aria-hidden="true" className="mt-4 space-y-2">
        {partes.map((p) => (
          <li
            key={p.clave}
            className="flex items-center justify-between gap-3 text-body-md"
          >
            <span className="flex items-center gap-2 text-on-surface">
              <span className={`h-2.5 w-2.5 rounded-sm ${COLOR[p.clave]}`} />
              {p.etiqueta}
            </span>
            <span className="text-on-surface-variant">
              {p.clave === "whatsapp" && p.monto === 0
                ? "Próximamente"
                : `${formatearMonto(p.monto)} · ${p.porcentaje} %`}
            </span>
          </li>
        ))}
      </ul>
      <TablaAccesible
        titulo="Ventas dentro y fuera del local"
        columnas={["Lugar", "Monto", "Porcentaje"]}
        filas={partes.map((p) => [
          p.etiqueta,
          formatearMonto(p.monto),
          `${p.porcentaje} %`,
        ])}
        visible={false}
      />

      {rotacionMesas.aplica && (
        <p className="mt-auto flex justify-between border-t border-outline-variant pt-3 text-body-md">
          <span className="text-on-surface-variant">
            Ocupación promedio de una mesa
          </span>
          <span className="text-on-surface">
            {rotacionMesas.ocupacionPromedioMin} min
          </span>
        </p>
      )}
    </section>
  );
}
