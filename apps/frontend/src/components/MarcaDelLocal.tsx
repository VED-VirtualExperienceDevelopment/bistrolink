import { PORTADA_POR_DEFECTO } from "@/lib/portada-por-defecto";

/**
 * HU-043 (BL-534 y BL-562): el logo y la portada del local en la carta del
 * comensal. Están aparte de MenuDigital para que el componente principal no
 * sume más ramas (Sonar, complejidad cognitiva).
 */

/**
 * Logo del local en la barra de arriba, o «BistroLink» si no tiene. El logo
 * va en una caja de tamaño fijo para que la barra no salte al cargarlo, y no
 * compite con la imagen principal (LCP): sin prioridad alta.
 */
export function LogoDelLocal({
  logoUrl,
  nombre,
}: Readonly<{ logoUrl?: string | null; nombre: string }>) {
  if (!logoUrl) {
    return (
      <span className="text-xl md:text-2xl font-bold text-marca">
        BistroLink
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={nombre}
      width={160}
      height={40}
      decoding="async"
      className="h-10 w-32 md:w-40 object-contain object-left"
    />
  );
}

/**
 * Foto del banner de la carta: la imagen principal de la página (LCP), con
 * prioridad alta. Decorativa: el nombre ya está en el <h1>.
 *
 * - Sin portada propia: la de por defecto en varios tamaños, recortada para
 *   llenar el banner (object-cover).
 * - Con portada propia (un WebP de hasta 1600 px, por la CDN): se ve
 *   COMPLETA (object-contain), porque puede tener el logo o un texto que no
 *   se puede cortar y el banner cambia de proporción entre el celular y la
 *   PC. Lo que sobra se llena con la misma foto difuminada (misma URL: se
 *   baja una sola vez).
 */
export function ImagenDePortada({
  portadaUrl,
}: Readonly<{ portadaUrl?: string | null }>) {
  const comun =
    "absolute inset-0 w-full h-full object-center transition-transform duration-700 group-hover:scale-105";
  if (!portadaUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={PORTADA_POR_DEFECTO.src}
        srcSet={PORTADA_POR_DEFECTO.srcSet}
        sizes="(min-width: 1440px) 1376px, calc(100vw - 2rem)"
        alt=""
        fetchPriority="high"
        loading="eager"
        decoding="async"
        className={`${comun} object-cover`}
      />
    );
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={portadaUrl}
        alt=""
        loading="eager"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-80"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={portadaUrl}
        alt=""
        fetchPriority="high"
        loading="eager"
        decoding="async"
        className={`${comun} object-contain`}
      />
    </>
  );
}
