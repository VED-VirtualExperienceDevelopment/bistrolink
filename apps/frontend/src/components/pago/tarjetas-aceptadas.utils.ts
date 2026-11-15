/**
 * HU-051 (BL-563): sello de pago seguro. Funciones puras (con test).
 */

/** Una marca de tarjeta aceptada, como la devuelve la API. */
export interface TarjetaAceptada {
  readonly id: string;
  readonly nombre: string;
  readonly imagen: string | null;
  readonly credito: boolean;
  readonly debito: boolean;
}

/** Lo completa el logo de Mercado Pago (o, si no carga, su nombre). */
export const TEXTO_PAGO_SEGURO = "Pago seguro con";
export const NOMBRE_TARJETAS_ACEPTADAS = "Tarjetas aceptadas";

/** «debvisa» → «visa»: la marca del medio que detectó Mercado Pago. */
export function marcaDelMedio(
  paymentMethodId: string | null | undefined,
): string | null {
  if (!paymentMethodId) return null;
  return paymentMethodId.toLowerCase().replace(/^deb(?=.)/, "");
}

function esTarjeta(valor: unknown): valor is TarjetaAceptada {
  if (typeof valor !== "object" || valor === null) return false;
  const t = valor as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    t.id !== "" &&
    typeof t.nombre === "string" &&
    (t.imagen === null || typeof t.imagen === "string")
  );
}

/**
 * La lista de la API, sin repetidos y solo con imágenes por HTTPS. Una
 * respuesta con otra forma da una lista vacía: el sello muestra solo el
 * texto y el pago sigue igual.
 */
export function tarjetasDeLaRespuesta(cuerpo: unknown): TarjetaAceptada[] {
  if (typeof cuerpo !== "object" || cuerpo === null) return [];
  const { tarjetas } = cuerpo as { tarjetas?: unknown };
  if (!Array.isArray(tarjetas)) return [];
  const vistas = new Set<string>();
  const lista: TarjetaAceptada[] = [];
  for (const t of tarjetas) {
    if (!esTarjeta(t) || vistas.has(t.id)) continue;
    vistas.add(t.id);
    lista.push({
      id: t.id,
      nombre: t.nombre,
      imagen: t.imagen?.startsWith("https://") ? t.imagen : null,
      credito: t.credito === true,
      debito: t.debito === true,
    });
  }
  return lista;
}

/** Cómo se ve cada tarjeta según la marca detectada al escribir el número. */
export function estadoDeTarjeta(
  tarjeta: Pick<TarjetaAceptada, "id">,
  marcaDetectada: string | null,
): "normal" | "detectada" | "atenuada" {
  if (!marcaDetectada) return "normal";
  return tarjeta.id === marcaDetectada ? "detectada" : "atenuada";
}

/** Texto alternativo de la imagen de una tarjeta. */
export function textoTarjeta(tarjeta: TarjetaAceptada): string {
  if (tarjeta.credito && tarjeta.debito)
    return `${tarjeta.nombre} (crédito y débito)`;
  if (tarjeta.debito) return `${tarjeta.nombre} (débito)`;
  return tarjeta.nombre;
}
