const BLOQUE = "animate-pulse rounded-xl bg-surface-container-high";

/** HU-012 (BL-108): la forma del dashboard mientras carga. */
export default function SkeletonReportes() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only">Cargando los reportes…</span>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className={`${BLOQUE} h-28`} />
        ))}
      </div>
      <div aria-hidden="true" className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className={`${BLOQUE} h-72`} />
        <div className={`${BLOQUE} h-72`} />
      </div>
      <div aria-hidden="true" className={`${BLOQUE} h-80`} />
    </div>
  );
}
