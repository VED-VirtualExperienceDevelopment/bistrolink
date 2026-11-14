/**
 * HU-036 (BL-206): política de privacidad del establecimiento (Ley 18.331).
 * Lógica pura, probada en test/unitarios/privacidad.utils.spec.ts.
 *
 * La página /privacidad recibe de dónde viene el comensal:
 * - desde el QR de una mesa: ?qr=<token> (el frontend no conoce ids, BL-204);
 * - desde la carta web: ?t=<tenantId>&r=<restauranteId>.
 * Con eso pide a la API los datos del responsable (el establecimiento).
 */
import {
  esTokenQrConFormatoValido,
  type OrigenMenu,
} from "@/components/menu-digital.utils";

export const RUTA_PRIVACIDAD = "/privacidad";

/** Fecha de la última versión del texto de la política. */
export const ACTUALIZACION_POLITICA = "10/11/2026";

/** Enlace a la política desde la carta o el pago. */
export function rutaPrivacidad(origen: OrigenMenu): string {
  if (origen.tipo === "mesa") {
    return `${RUTA_PRIVACIDAD}?${new URLSearchParams({ qr: origen.qrToken }).toString()}`;
  }
  // HU-033 (BL-203): el link de pago no lleva ids: la política general.
  if (origen.tipo === "link") return RUTA_PRIVACIDAD;
  const parametros = new URLSearchParams({
    t: origen.tenantId,
    r: origen.restauranteId,
  });
  return `${RUTA_PRIVACIDAD}?${parametros.toString()}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ruta de la API con los datos del establecimiento según los parámetros de
 * la página, o null si no hay (o no tienen formato válido): la política se
 * muestra igual, sin los datos del local.
 */
export function rutaApiPrivacidad(parametros: {
  qr?: string;
  t?: string;
  r?: string;
}): string | null {
  if (parametros.qr && esTokenQrConFormatoValido(parametros.qr)) {
    return `/menu/qr/${encodeURIComponent(parametros.qr)}/privacidad`;
  }
  if (
    parametros.t &&
    parametros.r &&
    UUID.test(parametros.t) &&
    UUID.test(parametros.r)
  ) {
    return `/menu/tenant/${parametros.t}/restaurante/${parametros.r}/privacidad`;
  }
  return null;
}

/** Respuesta de GET .../privacidad. */
export interface DatosPrivacidad {
  establecimiento: {
    nombre: string;
    razonSocial: string;
    rut: string;
    direccion: string;
    emailPrivacidad: string | null;
  };
}

/** RUT con el formato habitual: 21 999999 0016. */
export function formatearRut(rut: string): string {
  const digitos = rut.replace(/\D/g, "");
  return digitos.length === 12
    ? `${digitos.slice(0, 2)} ${digitos.slice(2, 8)} ${digitos.slice(8)}`
    : rut;
}
