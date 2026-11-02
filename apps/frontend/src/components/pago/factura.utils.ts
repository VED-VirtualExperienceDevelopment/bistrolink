/**
 * HU-009 (BL-453): e-Factura con RUT y razón social. Lógica pura del
 * formulario de la pantalla de pago, separada del componente para testearla.
 *
 * El CFE se emite cuando se aprueba el pago (tarjeta o cobro del mozo), así
 * que el comensal la pide antes de pagar. Los datos viajan en el mismo
 * POST del pago (o del aviso de efectivo) como `receptorFiscal`.
 *
 * Reglas (las vuelve a aplicar el backend, que es quien decide):
 * - Sin aceptar el aviso de privacidad (HU-036) no se mandan los datos y se
 *   emite un e-Ticket. No bloquea el pago.
 * - Con el aviso aceptado, el RUT y la razón social tienen que ser válidos:
 *   mientras no lo sean, el botón de pagar queda deshabilitado (si no, el
 *   comensal recibiría un e-Ticket sin darse cuenta del error).
 */
import { errorDeRut, normalizarRut } from "@/lib/rut";

/** Mismo tope que Surtec (`denominacion`) y que la columna del pedido. */
export const LARGO_MAXIMO_RAZON_SOCIAL_RECEPTOR = 150;

export interface FormularioFactura {
  /** El comensal marcó «Quiero e-Factura con RUT». */
  quiere: boolean;
  rut: string;
  razonSocial: string;
  /** Aceptó el aviso de privacidad. */
  consentimiento: boolean;
}

export const FACTURA_VACIA: FormularioFactura = {
  quiere: false,
  rut: "",
  razonSocial: "",
  consentimiento: false,
};

/** Lo que espera el backend en `receptorFiscal`. */
export interface ReceptorFiscal {
  rut: string;
  razonSocial: string;
  consentimiento: true;
}

export interface ErroresFactura {
  rut?: string;
  razonSocial?: string;
}

/** Hay que validar los datos: pidió e-Factura y aceptó el aviso. */
function seEmiteEFactura(f: FormularioFactura): boolean {
  return f.quiere && f.consentimiento;
}

export function erroresFactura(f: FormularioFactura): ErroresFactura {
  if (!seEmiteEFactura(f)) return {};
  const errores: ErroresFactura = {};
  const errorRut = errorDeRut(f.rut);
  if (errorRut) errores.rut = errorRut;
  if (f.razonSocial.trim().length === 0) {
    errores.razonSocial = "Ingresá la razón social como figura en el RUT.";
  }
  return errores;
}

/** Pidió e-Factura con el aviso aceptado, pero faltan datos o no son válidos. */
export function facturaBloqueaElPago(f: FormularioFactura): boolean {
  return Object.keys(erroresFactura(f)).length > 0;
}

/** Pidió e-Factura y no aceptó el aviso: se le avisa que recibe un e-Ticket. */
export function facturaSinConsentimiento(f: FormularioFactura): boolean {
  return f.quiere && !f.consentimiento;
}

/**
 * `receptorFiscal` del POST: los datos normalizados si corresponde una
 * e-Factura; si no, null (el pedido queda sin RUT ni razón social).
 */
export function receptorParaEnviar(
  f: FormularioFactura,
): ReceptorFiscal | null {
  if (!seEmiteEFactura(f) || facturaBloqueaElPago(f)) return null;
  return {
    rut: normalizarRut(f.rut),
    razonSocial: f.razonSocial.trim().split(/\s+/).join(" "),
    consentimiento: true,
  };
}

/** Nombre del comprobante según su tipo de CFE (111 e-Factura, 101 e-Ticket). */
export function nombreDelComprobante(tipoCfe: string | undefined): string {
  return tipoCfe === "111" ? "e-Factura" : "e-Ticket";
}
