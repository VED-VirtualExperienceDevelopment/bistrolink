import AvisoMesaQr from "@/components/AvisoMesaQr";

/**
 * BL-304: 404 del menú público (HU-002) en español. Antes se veía la página
 * por defecto de Next, en inglés («This page could not be found»).
 *
 * La muestra notFound() de page.tsx cuando la API dice que el local no
 * existe (404) o que la URL no es válida (400), así que la respuesta sigue
 * siendo HTTP 404. Un error real de la API (500, caída) no pasa por acá: lo
 * muestra app/error.tsx (BL-517), en español y con «Reintentar». El título
 * de la pestaña («Local no encontrado») lo pone generateMetadata de page.tsx.
 */
export default function MenuPublicoNoEncontrado() {
  return (
    <AvisoMesaQr
      icono="🍽️"
      titulo="No encontramos este local."
      detalle="Revisá el enlace o pedile al local que te lo pase de nuevo."
    />
  );
}
