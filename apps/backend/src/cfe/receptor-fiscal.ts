import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { esRutValido } from '../plataforma/rut';

/**
 * HU-009 (BL-453): el comensal pide e-Factura (tipo 111) con su RUT y su
 * razón social. Viaja opcional en POST /pedidos/:id/pagos y en
 * POST .../solicitud-efectivo, porque el CFE se emite cuando se aprueba el
 * pago y el comensal tiene que pedirla antes.
 *
 * El DTO solo controla tipos y largos: si los datos no alcanzan para una
 * e-Factura (RUT inválido, razón social vacía o sin aceptar el aviso), el
 * pago sigue igual y se emite un e-Ticket (criterio de HU-009). La pantalla
 * ya avisa del error antes de pagar.
 */
export class ReceptorFiscalDto {
  /** Con o sin puntos, guiones o espacios: se normaliza antes de validar. */
  @IsString()
  @MaxLength(20)
  rut: string;

  /** Surtec admite hasta 150 caracteres en `denominacion`. */
  @IsString()
  @MaxLength(150)
  razonSocial: string;

  /** HU-036 (BL-206): aceptó el aviso de privacidad. Sin aceptarlo no se guarda. */
  @IsBoolean()
  consentimiento: boolean;
}

export const LARGO_MAXIMO_RAZON_SOCIAL_RECEPTOR = 150;

/** Columnas de pedido con el receptor de la e-Factura. */
export interface ReceptorEnPedido {
  receptorRut: string | null;
  receptorRazonSocial: string | null;
  receptorConsentidoEn: Date | null;
}

const SIN_RECEPTOR: ReceptorEnPedido = {
  receptorRut: null,
  receptorRazonSocial: null,
  receptorConsentidoEn: null,
};

/** RUT sin espacios, puntos ni guiones («21.999999-001-6» → «219999990016»). */
export function normalizarRut(rut: string): string {
  return rut.replaceAll(/[\s.-]/g, '');
}

/** Razón social sin espacios de más; vacía si no tiene texto. */
export function normalizarRazonSocial(razonSocial: string): string {
  return razonSocial.trim().replaceAll(/\s+/g, ' ');
}

/**
 * Qué guardar en el pedido según lo que mandó el comensal:
 * - `undefined` (no vino el campo): no se toca lo que ya tenía el pedido.
 *   Por ejemplo, «Avisar de nuevo» al mozo no repite el formulario.
 * - `null`: el comensal sacó el pedido de e-Factura; se borra.
 * - Datos sin consentimiento, RUT inválido o razón social vacía: se borra y
 *   se emite un e-Ticket.
 * - Datos válidos con consentimiento: se guardan, con la fecha del
 *   consentimiento.
 */
export function receptorParaGuardar(
  receptor: ReceptorFiscalDto | null | undefined,
  ahora: Date,
): ReceptorEnPedido | undefined {
  if (receptor === undefined) return undefined;
  if (receptor?.consentimiento !== true) return SIN_RECEPTOR;
  const rut = normalizarRut(receptor.rut);
  const razonSocial = normalizarRazonSocial(receptor.razonSocial);
  if (!esRutValido(rut) || razonSocial.length === 0) return SIN_RECEPTOR;
  return {
    receptorRut: rut,
    receptorRazonSocial: razonSocial.slice(
      0,
      LARGO_MAXIMO_RAZON_SOCIAL_RECEPTOR,
    ),
    receptorConsentidoEn: ahora,
  };
}
