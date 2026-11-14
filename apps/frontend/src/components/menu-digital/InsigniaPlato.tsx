/**
 * HU-044 (BL-537): insignia de un plato en el menú del comensal. La comparte
 * «Más pedido» (HU-045, BL-548), que agrega su variante.
 *
 * - Ícono SVG en línea: el menú no descarga la fuente de Material Symbols
 *   (BL-524, LCP de BL-438).
 * - Ícono y texto: el estado no depende solo del color.
 * - «Sugerencia del local»: fondo sólido con el color de acento de la
 *   plantilla del local (HU-043, `marca-acento`) y texto blanco. Todas las
 *   plantillas dan al menos 6,20:1 (plantillas-marca.ts); la Clásica,
 *   #755b00, 6,46:1.
 */
import type { VarianteInsignia } from "./insignias.utils";

const TEXTO: Record<VarianteInsignia, string> = {
  sugerencia: "Sugerencia del local",
};

export const TEXTO_SUGERENCIA_DEL_LOCAL = TEXTO.sugerencia;

/** Estrella de cinco puntas (rellena o solo el contorno). */
export function IconoEstrella({
  rellena,
  tamano = 16,
}: {
  readonly rellena: boolean;
  readonly tamano?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill={rellena ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M12 2.8l2.84 5.76 6.36.92-4.6 4.49 1.09 6.33L12 17.31l-5.69 2.99 1.09-6.33-4.6-4.49 6.36-.92z" />
    </svg>
  );
}

export function InsigniaPlato({
  variante,
}: {
  readonly variante: VarianteInsignia;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-marca-acento px-2.5 py-1 text-xs font-semibold text-white">
      <IconoEstrella rellena tamano={14} />
      {TEXTO[variante]}
    </span>
  );
}
