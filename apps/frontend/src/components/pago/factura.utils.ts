/**
 * HU-009 (BL-453): e-Factura con RUT y razón social. Lógica pura del
 * formulario de la pantalla de pago, separada del componente para testearla.
 *
 * El CFE se emite cuando se aprueba el pago (tarjeta o cobro del mozo), así
 * que el comensal la pide antes de pagar. Los datos viajan en el mismo
 * POST del pago (o del aviso de efectivo) como `receptorFiscal`.
 *
 * Reglas de la pantalla (BL-453, ajuste después de probar en staging):
 * - Si cargó el RUT o la razón social y no aceptó el aviso de privacidad
 *   (HU-036), no se paga: tiene que aceptarlo, o borrar los datos o
 *   desmarcar «Quiero e-Factura con RUT» (y recibe un e-Ticket). Así nunca
 *   recibe un e-Ticket sin darse cuenta.
 * - Con el aviso aceptado, el RUT y la razón social tienen que ser válidos.
 * - Marcó la e-Factura pero dejó los dos campos vacíos y sin aceptar: es lo
 *   mismo que no pedirla (borró los datos).
 *
 * El backend sigue siendo quien decide: sin consentimiento no guarda nada
 * y emite un e-Ticket (receptorParaGuardar).
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
  /** Cargó datos y no aceptó el aviso de privacidad. */
  consentimiento?: string;
}

export const MENSAJE_FALTA_CONSENTIMIENTO =
  "Para emitir la e-Factura tenés que aceptar que el local guarde tus datos. Si no querés, borrá el RUT y la razón social o desmarcá «Quiero e-Factura con RUT» y te damos un e-Ticket.";

/** Escribió algo en el RUT o en la razón social. */
function cargoDatos(f: FormularioFactura): boolean {
  return f.rut.trim().length > 0 || f.razonSocial.trim().length > 0;
}

/** Hay que validar los datos: pidió e-Factura y aceptó el aviso. */
function seEmiteEFactura(f: FormularioFactura): boolean {
  return f.quiere && f.consentimiento;
}

export function erroresFactura(f: FormularioFactura): ErroresFactura {
  if (!f.quiere) return {};
  if (!f.consentimiento) {
    return cargoDatos(f)
      ? { consentimiento: MENSAJE_FALTA_CONSENTIMIENTO }
      : {};
  }
  const errores: ErroresFactura = {};
  const errorRut = errorDeRut(f.rut);
  if (errorRut) errores.rut = errorRut;
  if (f.razonSocial.trim().length === 0) {
    errores.razonSocial = "Ingresá la razón social como figura en el RUT.";
  }
  return errores;
}

/** Faltan datos, no son válidos o falta aceptar el aviso: no se paga. */
export function facturaBloqueaElPago(f: FormularioFactura): boolean {
  return Object.keys(erroresFactura(f)).length > 0;
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
    razonSocial: f.razonSocial.trim().replaceAll(/\s+/g, " "),
    consentimiento: true,
  };
}

/**
 * Nombre del comprobante según su tipo de CFE (111 e-Factura, 101 e-Ticket).
 * HU-024 (BL-104): 102 y 112 son sus notas de crédito.
 */
export function nombreDelComprobante(tipoCfe: string | undefined): string {
  if (tipoCfe === "102") return "Nota de crédito de e-Ticket";
  if (tipoCfe === "112") return "Nota de crédito de e-Factura";
  return tipoCfe === "111" ? "e-Factura" : "e-Ticket";
}
