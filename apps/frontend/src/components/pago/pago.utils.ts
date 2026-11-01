/**
 * BL-311 (HU-007): lógica pura del pago del comensal, separada de los
 * componentes para poder testearla (mismo criterio que menu-digital.utils.ts).
 *
 * Flujo (prepago, RD.03): el carrito confirmado crea el pedido en
 * PENDIENTE_PAGO; el comensal paga con tarjeta (Mercado Pago, Secure Fields)
 * y recién con el pago aprobado el pedido llega a cocina.
 */
import type { OrigenMenu } from "@/components/menu-digital.utils";
import { headersMesaQr } from "@/components/menu-digital.utils";

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
    // HU-017 (BL-60): el QR y la sesión de la mesa.
    return headersMesaQr(origen);
  }
  return tokenAcceso ? { [HEADER_PEDIDO_TOKEN]: tokenAcceso } : {};
}

const FORMATO_PESOS_ENTEROS = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "UYU",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const FORMATO_PESOS_CON_CENTESIMOS = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "UYU",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Precio en pesos uruguayos: «$ 590» si es entero y «$ 590,50» si tiene
 * centésimos. BL-398: antes se redondeaba siempre a pesos enteros, y un
 * ítem de $ 590,50 se mostraba como $ 591 aunque se cobrara $ 590,50.
 * Se redondea a centésimos antes de decidir, para que un total calculado en
 * el navegador (590,1 + 0,2) no muestre decimales de más.
 */
export function formatearPrecio(valor: number | string): string {
  const centesimos = Math.round(Number(valor) * 100);
  const pesos = centesimos / 100;
  return centesimos % 100 === 0
    ? FORMATO_PESOS_ENTEROS.format(pesos)
    : FORMATO_PESOS_CON_CENTESIMOS.format(pesos);
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
    ? {
        identificationType: "CI",
        identificationNumber: normalizarDocumento(valor),
      }
    : { identificationType: "OTRO", identificationNumber: valor.trim() };
}

/**
 * Formato básico de un correo: una sola «@», algo antes, y un dominio con un
 * punto y al menos 2 caracteres después del último punto. Sin expresión
 * regular a propósito: la versión con regex podía tardar de más
 * (backtracking) con textos largos y armados para eso.
 */
function esCorreoValido(correo: string): boolean {
  if (correo.length === 0 || /\s/.test(correo)) return false;
  const arroba = correo.indexOf("@");
  if (arroba < 1 || arroba !== correo.lastIndexOf("@")) return false;
  const dominio = correo.slice(arroba + 1);
  const punto = dominio.lastIndexOf(".");
  return punto > 0 && dominio.length - punto - 1 >= 2;
}

export function errorEmail(valor: string): string | null {
  return esCorreoValido(valor.trim())
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
    // HU-032 (BL-202): «VENCIDO» si el pago no se confirmó a tiempo.
    motivoRechazo?: string | null;
  } | null;
  comprobante: {
    serie: string;
    numero: number;
    urlConsulta: string | null;
  } | null;
  /**
   * HU-031b (BL-442): pago en efectivo. `disponible` solo en pedidos de mesa
   * de un local que acepta efectivo. Opcional: un backend anterior no lo trae.
   */
  efectivo?: {
    disponible: boolean;
    solicitadoEn: string | null;
    pagaCon: string | null;
  };
  /**
   * BL-452: pago con tarjeta (Mercado Pago). `disponible` si el local tiene
   * Mercado Pago habilitado (HU-020). Opcional: un backend anterior no lo trae.
   */
  tarjeta?: { disponible: boolean };
  /** HU-037 (BL-207): opcional, un backend anterior no lo trae. */
  rebajaIva?: RebajaIva | null;
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
    case 410:
      // HU-017 (BL-60): la mesa se cerró o la sesión terminó; el backend
      // redacta el motivo para el comensal.
      return { tipo: "error", mensaje: mensajeBackend ?? MENSAJE_SIN_ACCESO };
    case 401:
    case 403:
    case 404:
      return { tipo: "error", mensaje: MENSAJE_SIN_ACCESO };
    default:
      return { tipo: "error", mensaje: MENSAJE_ERROR_GENERICO };
  }
}

/** HU-032 (BL-202): motivo del backend para un pago que venció. */
export const MOTIVO_PAGO_VENCIDO = "VENCIDO";

export const MENSAJE_PAGO_VENCIDO =
  "No recibimos la confirmación de Mercado Pago a tiempo y cancelamos el intento. Tu pedido sigue guardado: podés pagar de nuevo.";

/** Resultado según el estado del pago (respuesta del POST o del GET). */
export function resultadoDeEstado(
  estado: EstadoPago | undefined,
  motivoRechazo?: string | null,
): ResultadoPago {
  if (estado === "APROBADO") return { tipo: "aprobado" };
  if (estado === "RECHAZADO") {
    return {
      tipo: "rechazado",
      mensaje:
        motivoRechazo === MOTIVO_PAGO_VENCIDO
          ? MENSAJE_PAGO_VENCIDO
          : "El pago fue rechazado. No se realizó ningún cargo: probá con otra tarjeta.",
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

// ── Comprobante (CFE) en la pantalla de pago aprobado ────────────────────

/**
 * HU-037 (BL-207): rebaja de IVA de la Ley 17.934 que informa la API en un
 * pago con tarjeta de un consumo en el local. Informativa: el comprobante va
 * por el total y la reducción la descuenta la administradora del medio de
 * pago.
 */
export interface RebajaIva {
  ley: "17.934";
  puntos: number;
  totalSinReduccion: string;
  reduccion: string;
  neto: string;
  leyenda: string;
}

export type EstadoComprobante =
  | {
      tipo: "emitido";
      texto: string;
      urlConsulta: string | null;
      /** HU-037 (BL-207): solo si el pago tiene la rebaja. */
      rebaja: RebajaIva | null;
    }
  | { tipo: "emitiendo" };

/**
 * HU-037 (BL-207): filas del detalle de la rebaja, como pide DGI para el
 * comprobante del pago: total sin reducción, monto de la reducción y neto.
 */
export function filasRebajaIva(
  rebaja: RebajaIva,
): { etiqueta: string; valor: string }[] {
  return [
    {
      etiqueta: "Total sin reducción",
      valor: formatearPrecio(rebaja.totalSinReduccion),
    },
    {
      etiqueta: `Reducción de IVA (${rebaja.puntos} puntos)`,
      valor: `− ${formatearPrecio(rebaja.reduccion)}`,
    },
    { etiqueta: "Total neto", valor: formatearPrecio(rebaja.neto) },
  ];
}

/**
 * Número del e-Ticket para mostrar: serie y número con 7 dígitos, como
 * figura en el CFE impreso («A-0001234»).
 */
export function numeroComprobante(serie: string, numero: number): string {
  return `${serie}-${String(numero).padStart(7, "0")}`;
}

/**
 * Solo enlaces https: la URL de consulta la manda el proveedor de CFE y se
 * pone en un <a href>; un «javascript:» o un «http:» no se muestra.
 */
export function urlConsultaSegura(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Qué mostrar del comprobante según GET /pedidos/:id/pagos. */
export function estadoComprobante(
  estado: Pick<EstadoPagoDelPedido, "comprobante" | "rebajaIva"> | null,
): EstadoComprobante {
  const c = estado?.comprobante;
  if (!c) return { tipo: "emitiendo" };
  return {
    tipo: "emitido",
    texto: `e-Ticket ${numeroComprobante(c.serie, c.numero)}`,
    urlConsulta: urlConsultaSegura(c.urlConsulta),
    rebaja: estado?.rebajaIva ?? null,
  };
}

// ── Pago en efectivo (HU-031b, BL-442) ───────────────────────────────────

/** POST: el comensal de una mesa avisa que paga en efectivo. */
export function rutaSolicitudEfectivo(pedidoId: string): string {
  return `${rutaPagos(pedidoId)}/solicitud-efectivo`;
}

/** Respuesta de POST .../solicitud-efectivo. */
export interface SolicitudEfectivo {
  total: string;
  pagaCon: string | null;
  solicitadoEn: string;
  /** false si ya se había avisado hace menos de un minuto. */
  avisado: boolean;
}

export type MetodoPago = "tarjeta" | "efectivo";

/** BL-452: medios que el local ofrece para este pedido. */
export interface MediosDisponibles {
  tarjeta: boolean;
  efectivo: boolean;
}

/**
 * BL-452: medios disponibles según GET .../pagos. Si el backend no informa
 * la tarjeta (versión anterior), se ofrece como antes: la API igual rechaza
 * con 409 un pago con un medio deshabilitado.
 */
export function mediosDisponibles(
  estado: Pick<EstadoPagoDelPedido, "tarjeta" | "efectivo">,
): MediosDisponibles {
  return {
    tarjeta: estado.tarjeta?.disponible ?? true,
    efectivo: estado.efectivo?.disponible ?? false,
  };
}

/** Sin la consulta (error de red): solo la tarjeta, como antes de BL-452. */
export const MEDIOS_SIN_CONSULTA: MediosDisponibles = {
  tarjeta: true,
  efectivo: false,
};

/**
 * BL-452: qué muestra la pantalla de pago. Con los dos medios, el selector;
 * con uno solo, ese medio directo (sin selector); sin ninguno, el aviso.
 */
export type OpcionesPago =
  | { tipo: "selector" }
  | { tipo: "solo"; metodo: MetodoPago }
  | { tipo: "ninguno" };

export function opcionesDePago(medios: MediosDisponibles): OpcionesPago {
  if (medios.tarjeta && medios.efectivo) return { tipo: "selector" };
  if (medios.tarjeta) return { tipo: "solo", metodo: "tarjeta" };
  if (medios.efectivo) return { tipo: "solo", metodo: "efectivo" };
  return { tipo: "ninguno" };
}

/** El método que queda elegido: el actual si sigue disponible. */
export function metodoSegunMedios(
  medios: MediosDisponibles,
  actual: MetodoPago,
): MetodoPago {
  if (actual === "tarjeta" && !medios.tarjeta && medios.efectivo) {
    return "efectivo";
  }
  if (actual === "efectivo" && !medios.efectivo) return "tarjeta";
  return actual;
}

/** BL-452: aviso cuando el local no ofrece ningún medio para este pedido. */
export function mensajeSinMedios(tipoOrigen: OrigenMenu["tipo"]): string {
  return tipoOrigen === "mesa"
    ? "Este local no tiene pagos desde el celular habilitados. Llamá al mozo para que te cobre."
    : "Este local no tiene pagos en línea habilitados para pedidos para retirar. Acercate al local para pagar.";
}

/** Mientras se espera al mozo, se consulta cada 5 segundos... */
export const INTERVALO_CONSULTA_EFECTIVO_MS = 5_000;
/** ...hasta 20 minutos; después se ofrece consultar a mano. */
export const TOPE_CONSULTA_EFECTIVO_MS = 20 * 60_000;

export type EstadoPagaCon =
  | { tipo: "vacio" }
  | { tipo: "invalido" }
  | { tipo: "insuficiente" }
  | { tipo: "ok"; monto: string };

/**
 * «¿Con cuánto vas a pagar?»: opcional. Acepta «1000», «1000,50» o
 * «1000.50» (mismo formato que valida el backend) y no puede ser menor que
 * el total. Se compara en centésimos para no arrastrar errores de redondeo.
 */
export function evaluarPagaCon(texto: string, total: number): EstadoPagaCon {
  const limpio = texto.trim().replace(",", ".");
  if (limpio === "") return { tipo: "vacio" };
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(limpio)) return { tipo: "invalido" };
  const [enteros, decimales = ""] = limpio.split(".");
  const centesimos = Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
  if (centesimos < Math.round(total * 100)) return { tipo: "insuficiente" };
  return { tipo: "ok", monto: limpio };
}

/** Lo que ve el comensal mientras espera al mozo. */
export function mensajeEsperandoMozo(
  total: number | string,
  pagaCon: string | null,
): string {
  const base = `Avisamos al mozo. Tené listos ${formatearPrecio(total)}.`;
  return pagaCon
    ? `${base} Le dijimos que pagás con ${formatearPrecio(pagaCon)}, así trae el cambio.`
    : base;
}

/**
 * Pantalla con la que abre «Pagar» según el estado real del pedido
 * (HU-031b, BL-448). Importa sobre todo al retomar después de recargar:
 * - «efectivo»: pedido de mesa en PENDIENTE_PAGO que ya avisó al mozo, sin
 *   un pago con tarjeta en curso;
 * - «verificando»: hay un pago con tarjeta PENDIENTE (no se ofrece pagar de
 *   nuevo);
 * - «formulario»: lo de siempre.
 */
export function pantallaAlAbrir(
  estado: Pick<EstadoPagoDelPedido, "estadoPedido" | "pago" | "efectivo">,
  esMesa: boolean,
): "efectivo" | "verificando" | "formulario" {
  if (estado.estadoPedido !== "PENDIENTE_PAGO") return "formulario";
  if (estado.pago?.estado === "PENDIENTE") return "verificando";
  if (esMesa && estado.efectivo?.solicitadoEn) return "efectivo";
  return "formulario";
}
