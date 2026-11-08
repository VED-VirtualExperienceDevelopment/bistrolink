import {
  formatearMonto,
  formatearRotacion,
  MENSAJE_ROTACION_NO_APLICA,
  variacion,
  type Periodo,
  type ReporteVentas,
} from "./reportes.utils";

const CLASE_KPI =
  "flex flex-col gap-1 rounded-xl border border-outline-variant bg-surface-container-lowest p-4";

function Variacion({
  actual,
  anterior,
  periodo,
}: Readonly<{ actual: number; anterior: number; periodo: Periodo }>) {
  const { sentido, texto } = variacion(actual, anterior, periodo);
  const estilos = {
    sube: { clase: "text-green-700", icono: "trending_up" },
    baja: { clase: "text-error", icono: "trending_down" },
    igual: { clase: "text-on-surface-variant", icono: "trending_flat" },
  }[sentido];
  return (
    <p className={`flex items-center gap-1 text-body-sm ${estilos.clase}`}>
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[16px]"
      >
        {estilos.icono}
      </span>
      {texto}
    </p>
  );
}

/** HU-012 (BL-108): las 4 tarjetas de arriba del dashboard. */
export default function TarjetasResumen({
  reporte,
  periodo,
}: Readonly<{ reporte: ReporteVentas; periodo: Periodo }>) {
  const { resumen, rotacionMesas } = reporte;
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <li className={CLASE_KPI}>
        <h2 className="text-label-md text-on-surface-variant">Total vendido</h2>
        <p className="text-headline-md text-on-surface">
          {formatearMonto(resumen.totalVendido)}
        </p>
        <Variacion
          actual={resumen.totalVendido}
          anterior={resumen.anterior.totalVendido}
          periodo={periodo}
        />
      </li>
      <li className={CLASE_KPI}>
        <h2 className="text-label-md text-on-surface-variant">
          Pedidos pagados
        </h2>
        <p className="text-headline-md text-on-surface">{resumen.pedidos}</p>
        <Variacion
          actual={resumen.pedidos}
          anterior={resumen.anterior.pedidos}
          periodo={periodo}
        />
      </li>
      <li className={CLASE_KPI}>
        <h2 className="text-label-md text-on-surface-variant">
          Ticket promedio
        </h2>
        <p className="text-headline-md text-on-surface">
          {formatearMonto(resumen.ticketPromedio)}
        </p>
        <p className="text-body-sm text-on-surface-variant">por pedido</p>
      </li>
      <li className={CLASE_KPI}>
        <h2 className="text-label-md text-on-surface-variant">
          Rotación de mesas
        </h2>
        {rotacionMesas.aplica ? (
          <>
            <p className="text-headline-md text-on-surface">
              {formatearRotacion(rotacionMesas.rotacion)}
            </p>
            <p className="text-body-sm text-on-surface-variant">
              turnos por mesa ({rotacionMesas.sesiones} en {rotacionMesas.mesas}{" "}
              mesas)
            </p>
          </>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            No aplica. {MENSAJE_ROTACION_NO_APLICA}
          </p>
        )}
      </li>
    </ul>
  );
}
