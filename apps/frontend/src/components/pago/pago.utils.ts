/**
 * BL-311 (HU-007): lógica pura del pago del comensal, separada de los
 * componentes para poder testearla (mismo criterio que menu-digital.utils.ts).
 *
 * Flujo (prepago, RD.03): el carrito confirmado crea el pedido en
 * PENDIENTE_PAGO; el comensal paga con tarjeta (Mercado Pago, Secure Fields)
 * y recién con el pago aprobado el pedido llega a cocina.
 */
import type { OrigenMenu } from "@/components/menu-digital.utils";
import { HEADER_MESA_TOKEN } from "@/components/menu-digital.utils";

/** Header con el token de acceso de un pedido para retirar (backend: HEADER_PEDIDO_TOKEN). */
export const HEADER_PEDIDO_TOKEN = "X-Pedido-Token";

/** POST (pagar) y GET (estado y comprobante) del pago de un pedido. */
export function rutaPagos(pedidoId: string): string {
  return `/pedidos/${encodeURIComponent(pedidoId)}/pagos`;
}

/**
 * BL-311 (RD.05): credencial que prueba que el pedido es de quien paga.
 * - Mesa: el token del QR (la mesa del QR tiene que ser la del pedido).
 * - Pedido para retirar: el token que devolvió POST /pedidos.
 */
export function headersAccesoPedido(
  origen: OrigenMenu,
  tokenAcceso?: string,
): Record<string, string> {
  if (origen.tipo === "mesa") {
    return { [HEADER_MESA_TOKEN]: origen.qrToken };
  }
  return tokenAcceso ? { [HEADER_PEDIDO_TOKEN]: tokenAcceso } : {};
}

/** Precio en pesos uruguayos, sin decimales (mismo formato que la carta). */
export function formatearPrecio(valor: number | string): string {
  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency: "UYU",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(valor));
}

/**
 * Código corto para mostrar el pedido («#3CDF1D»): los primeros 6
 * caracteres del id. No es un código de retiro aparte (el modelo no tiene
 * uno); sirve para que el comensal y el local hablen del mismo pedido.
 */
export function codigoPedido(pedidoId: string): string {
  return `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/**
 * Firma del carrito: si el comensal vuelve a la carta y no cambia nada, se
 * reusa el pedido que ya está esperando el pago en lugar de crear otro.
 */
export function firmaCarrito(
  items: readonly {
    itemCartaId: string;
    cantidad: number;
    observacion?: string;
  }[],
  observacionGeneral: string,
): string {
  return JSON.stringify({
    items: items.map((i) => [
      i.itemCartaId,
      i.cantidad,
      i.observacion?.trim() ?? "",
    ]),
    nota: observacionGeneral.trim(),
  });
}

// ── Documento del titular ────────────────────────────────────────────────

export type TipoDocumento = "CI" | "OTRO";

/**
 * Dígito verificador de la cédula uruguaya: pesos 2987634 sobre los 7
 * dígitos (con ceros a la izquierda), y (10 - suma % 10) % 10.
 */
export function digitoVerificadorCi(cuerpo: string): number {
  const pesos = [2, 9, 8, 7, 6, 3, 4];
  const digitos = cuerpo.padStart(7, "0").split("").map(Number);
  const suma = digitos.reduce((acc, d, i) => acc + d * pesos[i], 0);
  return (10 - (suma % 10)) % 10;
}

/** Solo los dígitos (acepta «1.234.567-2», «1234567-2» o «12345672»). */
export function normalizarDocumento(valor: string): string {
  return valor.replace(/\D/g, "");
}

/**
 * Mensaje de error del documento, o null si es válido. La cédula se valida
 * con su dígito verificador; «Otro» (pasaporte, documento extranjero:
 * turistas) solo exige que no esté vacío.
 */
export function errorDocumento(
  tipo: TipoDocumento,
  valor: string,
): string | null {
  if (tipo === "OTRO") {
    return valor.trim().length >= 4 ? null : "Ingresá el número de documento.";
  }
  const digitos = normalizarDocumento(valor);
  if (digitos.length < 7 || digitos.length > 8) {
    return "La cédula tiene 7 u 8 dígitos (con el verificador).";
  }
  const cuerpo = digitos.slice(0, -1);
  const verificador = Number(digitos.slice(-1));
  return digitoVerificadorCi(cuerpo) === verificador
    ? null
    : "Revisá la cédula: el dígito verificador no coincide.";
}

/** Valor que se manda a Mercado Pago: la CI solo con dígitos. */
export function documentoParaMercadoPago(
  tipo: TipoDocumento,
  valor: string,
): { identificationType: string; identificationNumber: string } {
  return tipo === "CI"
    ? { identificationType: "CI", identificationNumber: normalizarDocumento(valor) }
    : { identificationType: "OTRO", identificationNumber: valor.trim() };
}

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function errorEmail(valor: string): string | null {
  return FORMATO_EMAIL.test(valor.trim())
    ? null
    : "Ingresá un correo válido para recibir tu comprobante.";
}

export function errorTitular(valor: string): string | null {
  return valor.trim().length >= 3
    ? null
    : "Ingresá el nombre como figura en la tarjeta.";
}

// ── Resultado del pago ───────────────────────────────────────────────────

export type EstadoPago = "PENDIENTE" | "APROBADO" | "RECHAZADO" | "REEMBOLSADO";

/** Respuesta de GET /pedidos/:pedidoId/pagos (backend: EstadoPagoDelPedido). */
export interface EstadoPagoDelPedido {
  pedidoId: string;
  estadoPedido: string;
  pago: {
    id: string;
    estado: EstadoPago;
    medioPago: string;
    monto: string;
  } | null;
  comprobante: {
    serie: string;
    numero: number;
    urlConsulta: string | null;
  } | null;
}

/** Lo que la pantalla tiene que mostrar después de intentar pagar. */
export type ResultadoPago =
  | { tipo: "aprobado" }
  | { tipo: "rechazado"; mensaje: string }
  | { tipo: "verificando"; mensaje: string }
  | { tipo: "error"; mensaje: string };

export const MENSAJE_VERIFICANDO =
  "Estamos confirmando tu pago con Mercado Pago. No cierres esta pantalla: se actualiza sola.";
export const MENSAJE_ERROR_GENERICO =
  "No pudimos procesar el pago. No se realizó ningún cargo: probá de nuevo.";
export const MENSAJE_SIN_ACCESO =
  "No pudimos validar tu pedido. Volvé a la carta e intentá de nuevo.";

/**
 * Traduce la respuesta de POST /pedidos/:id/pagos a lo que ve el comensal.
 * Los textos de rechazo los redacta el backend (PagoRechazadoException):
 * se muestran tal cual.
 */
export function resultadoDeError(
  status: number,
  mensajeBackend?: string,
): ResultadoPago {
  switch (status) {
    case 402: // la tarjeta fue rechazada (fondos, banco): no hubo cargo
      return {
        tipo: "rechazado",
        mensaje: mensajeBackend ?? MENSAJE_ERROR_GENERICO,
      };
    case 409: // ya pagado o con un pago en curso: se consulta el estado real
    case 503: // la pasarela no respondió: el pago quedó pendiente
      return { tipo: "verificando", mensaje: MENSAJE_VERIFICANDO };
    case 400: // datos de tarjeta inválidos o vencidos
      return {
        tipo: "error",
        mensaje: mensajeBackend ?? MENSAJE_ERROR_GENERICO,
      };
    case 401:
    case 403:
    case 404:
    case 410:
      return { tipo: "error", mensaje: MENSAJE_SIN_ACCESO };
    default:
      return { tipo: "error", mensaje: MENSAJE_ERROR_GENERICO };
  }
}

/** Resultado según el estado del pago (respuesta del POST o del GET). */
export function resultadoDeEstado(estado: EstadoPago | undefined): ResultadoPago {
  if (estado === "APROBADO") return { tipo: "aprobado" };
  if (estado === "RECHAZADO") {
    return {
      tipo: "rechazado",
      mensaje: "El pago fue rechazado. No se realizó ningún cargo: probá con otra tarjeta.",
    };
  }
  return { tipo: "verificando", mensaje: MENSAJE_VERIFICANDO };
}

// ── Consulta periódica del estado ────────────────────────────────────────

/** Cada cuánto se consulta mientras el pago se verifica. */
export const INTERVALO_CONSULTA_MS = 3_000;
/** Después de esto se deja de consultar y se ofrece reintentar a mano. */
export const TOPE_CONSULTA_MS = 90_000;

export function seguirConsultando(inicio: number, ahora: number): boolean {
  return ahora - inicio < TOPE_CONSULTA_MS;
}

// ── Tarjeta ──────────────────────────────────────────────────────────────

/** Tipo de tarjeta que espera el backend (MercadoPagoGateway). */
export function tipoTarjeta(
  paymentTypeId: string | undefined,
): "credit_card" | "debit_card" {
  return paymentTypeId === "debit_card" ? "debit_card" : "credit_card";
}

/** Etiqueta corta de la marca para el campo del número («VISA», «OCA»). */
export function etiquetaMarca(nombre: string | undefined): string | null {
  if (!nombre) return null;
  return nombre.trim().toUpperCase();
}
