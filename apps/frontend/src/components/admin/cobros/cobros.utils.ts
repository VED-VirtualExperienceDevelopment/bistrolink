/**
 * HU-031 (BL-201): cobro en efectivo que registra el mozo o el administrador.
 * Lógica pura del panel de la mesa y de la pantalla /admin/cobros (probada
 * en test/unitarios/cobros.utils.spec.ts).
 */

/** Un pedido que espera el pago (backend: PedidoPendienteDeCobro). */
export interface PedidoPendienteDeCobro {
  id: string;
  canal: string;
  createdAt: string;
  mesa: { id: string; numero: number; esVirtual: boolean };
  /** Total con 2 decimales, como texto ("590.00"). */
  total: string;
  lineas: { id: string; nombre: string; cantidad: number; subtotal: string }[];
  /** El comensal tiene un pago con tarjeta en curso. */
  pagoEnCurso: boolean;
}

/** Respuesta de GET /cobros/pendientes. */
export interface PendientesDeCobro {
  efectivoHabilitado: boolean;
  pedidos: PedidoPendienteDeCobro[];
}

/** Respuesta de POST /cobros/efectivo. */
export interface CobroEfectivoRegistrado {
  pagoId: string;
  pedidoId: string;
  monto: string;
  montoRecibido: string;
  vuelto: string;
}

export const RUTA_PENDIENTES = "/cobros/pendientes";
export const RUTA_COBRO_EFECTIVO = "/cobros/efectivo";

/**
 * Mismo código que ve el comensal en su pantalla de pago (codigoPedido de
 * pago.utils): así el mozo encuentra el pedido que le muestran.
 */
export function codigoDelPedido(pedidoId: string): string {
  return `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/** Pedidos de una mesa del mapa. */
export function pendientesDeLaMesa(
  pedidos: PedidoPendienteDeCobro[],
  mesaId: string,
): PedidoPendienteDeCobro[] {
  return pedidos.filter((p) => p.mesa.id === mesaId);
}

/** Pedidos para retirar (mesa virtual, sin lugar en el mapa). */
export function pendientesParaRetirar(
  pedidos: PedidoPendienteDeCobro[],
): PedidoPendienteDeCobro[] {
  return pedidos.filter((p) => p.mesa.esVirtual);
}

/** Pedidos de las mesas del salón. */
export function pendientesEnMesas(
  pedidos: PedidoPendienteDeCobro[],
): PedidoPendienteDeCobro[] {
  return pedidos.filter((p) => !p.mesa.esVirtual);
}

const FORMATO_MONTO = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "UYU",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** «$ 590» o «$ 590,50». Sin redondear los centésimos del vuelto. */
export function formatearMonto(valor: string | number): string {
  return FORMATO_MONTO.format(Number(valor));
}

const FORMATO_HORA = new Intl.DateTimeFormat("es-UY", {
  timeZone: "America/Montevideo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** «21:05» en hora de Uruguay. */
export function horaDelPedido(iso: string): string {
  return FORMATO_HORA.format(new Date(iso));
}

/** «2 × Milanesa, 1 × Agua». */
export function resumenDeLineas(pedido: PedidoPendienteDeCobro): string {
  return pedido.lineas.map((l) => `${l.cantidad} × ${l.nombre}`).join(", ");
}

/**
 * Lo que escribe el mozo: «1000», «1000,50» o «1000.50». Devuelve el monto
 * normalizado para el backend («1000.50») o null si no es válido. Mismo
 * formato que valida el backend: hasta 8 dígitos y 2 decimales, sin signo.
 */
export function normalizarMontoRecibido(texto: string): string | null {
  const limpio = texto.trim().replace(",", ".");
  return /^\d{1,8}(\.\d{1,2})?$/.test(limpio) ? limpio : null;
}

/** Trabaja en centésimos para no arrastrar errores de punto flotante. */
function enCentesimos(monto: string): number {
  const [enteros, decimales = ""] = monto.split(".");
  return Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
}

export type EstadoMontoRecibido =
  | { tipo: "vacio" }
  | { tipo: "invalido" }
  | { tipo: "insuficiente"; falta: string }
  | { tipo: "ok"; recibido: string; vuelto: string };

/** Valida lo recibido contra el total y calcula el vuelto (o lo que falta). */
export function evaluarMontoRecibido(
  texto: string,
  total: string,
): EstadoMontoRecibido {
  if (texto.trim() === "") return { tipo: "vacio" };
  const recibido = normalizarMontoRecibido(texto);
  if (recibido === null) return { tipo: "invalido" };
  const diferencia = enCentesimos(recibido) - enCentesimos(total);
  if (diferencia < 0) {
    return { tipo: "insuficiente", falta: (-diferencia / 100).toFixed(2) };
  }
  return { tipo: "ok", recibido, vuelto: (diferencia / 100).toFixed(2) };
}

/** Motivo por el que no se puede cobrar en efectivo, o null si se puede. */
export function motivoSinEfectivo(
  pedido: PedidoPendienteDeCobro,
  efectivoHabilitado: boolean,
): string | null {
  if (!efectivoHabilitado) {
    return "El cobro en efectivo no está habilitado en este establecimiento.";
  }
  if (pedido.pagoEnCurso) {
    return "El comensal está pagando con tarjeta. Si no se confirma, vence solo en unos minutos.";
  }
  return null;
}

/** Aviso después de cobrar. */
export function mensajeCobroRegistrado(
  cobro: CobroEfectivoRegistrado,
): string {
  const codigo = codigoDelPedido(cobro.pedidoId);
  if (Number(cobro.vuelto) === 0) {
    return `Cobro registrado: pedido ${codigo}, sin vuelto. Ya está en cocina.`;
  }
  return `Cobro registrado: pedido ${codigo}. Vuelto: ${formatearMonto(cobro.vuelto)}. Ya está en cocina.`;
}

/**
 * Clave de idempotencia de un cobro: una por diálogo abierto. Si el mozo
 * hace doble clic o reintenta, se manda la misma y el backend no cobra dos
 * veces (RNF.03).
 */
export function nuevaClaveDeCobro(): string {
  return `efectivo-${crypto.randomUUID()}`;
}
