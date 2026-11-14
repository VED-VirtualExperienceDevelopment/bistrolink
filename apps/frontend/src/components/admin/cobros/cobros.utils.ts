/**
 * HU-031 (BL-201): cobro en efectivo que registra el mozo o el administrador.
 * HU-007b (BL-80): también el cobro hecho con el POS del local.
 * HU-022 (BL-495): el personal ve la propina que eligió el comensal (solo
 * lectura) y el total que cobra incluye esa propina.
 * Lógica pura del panel de la mesa y de la pantalla /admin/cobros (probada
 * en test/unitarios/cobros.utils.spec.ts).
 */

import { formatearPrecio } from "@/components/pago/pago.utils";

/** Un pedido que espera el pago (backend: PedidoPendienteDeCobro). */
export interface PedidoPendienteDeCobro {
  id: string;
  canal: string;
  createdAt: string;
  mesa: { id: string; numero: number; esVirtual: boolean };
  /** Total a cobrar con 2 decimales, propina incluida ("649.00"). */
  total: string;
  /**
   * HU-022 (BL-495): el consumo (lo que se factura) y la propina elegida.
   * Opcionales: un backend anterior no los trae y entonces no se muestra
   * desglose.
   */
  consumo?: string;
  propina?: string;
  /** Porcentaje elegido; null si fue un monto libre o no eligió propina. */
  propinaPorcentaje?: number | null;
  lineas: { id: string; nombre: string; cantidad: number; subtotal: string }[];
  /** El comensal tiene un pago con tarjeta en curso. */
  pagoEnCurso: boolean;
  /**
   * HU-033 (BL-203): hasta cuándo sirve el link de pago vigente; null si no
   * tiene o ya venció. Opcional: un backend anterior no lo trae.
   */
  linkPagoVenceEn?: string | null;
  /**
   * HU-031b (BL-442): el comensal avisó que paga en efectivo. Opcional: un
   * backend anterior no lo trae.
   */
  efectivoSolicitado?: { en: string; pagaCon: string | null } | null;
}

/** Respuesta de GET /cobros/pendientes. */
export interface PendientesDeCobro {
  efectivoHabilitado: boolean;
  /**
   * HU-007b (BL-80): el local registra cobros hechos con su POS. Opcional:
   * un backend anterior no lo trae (y entonces no se ofrece).
   */
  posHabilitado?: boolean;
  pedidos: PedidoPendienteDeCobro[];
}

/** Respuesta de POST /cobros/efectivo. */
export interface CobroEfectivoRegistrado {
  pagoId: string;
  pedidoId: string;
  /** Total cobrado (consumo + propina). */
  monto: string;
  /** HU-022 (BL-495): lo que se factura y la propina cobrada aparte. */
  consumo?: string;
  propina?: string;
  montoRecibido: string;
  vuelto: string;
}

export const RUTA_PENDIENTES = "/cobros/pendientes";
export const RUTA_COBRO_EFECTIVO = "/cobros/efectivo";

// ── HU-007b (BL-80): cobro con el POS del local ─────────────────────────

export type TarjetaPos = "CREDITO" | "DEBITO";

export const TARJETAS_POS: ReadonlyArray<{
  codigo: TarjetaPos;
  nombre: string;
}> = [
  { codigo: "DEBITO", nombre: "Débito" },
  { codigo: "CREDITO", nombre: "Crédito" },
];

/** Respuesta de POST /cobros/pos. */
export interface CobroPosRegistrado {
  pagoId: string;
  pedidoId: string;
  /** Total cobrado (consumo + propina). */
  monto: string;
  /** HU-022 (BL-495): lo que se factura y la propina cobrada aparte. */
  consumo?: string;
  propina?: string;
  tarjeta: TarjetaPos;
  autorizacion: string;
}

export const RUTA_COBRO_POS = "/cobros/pos";

/**
 * Lo que escribe el mozo como número de autorización del voucher. Devuelve
 * el valor normalizado (sin espacios ni guiones, en mayúsculas) o null si no
 * es válido. Mismo control que el backend: de 4 a 12 letras o números (con
 * más, podría ser un número de tarjeta, que nunca se guarda).
 */
export function normalizarAutorizacion(texto: string): string | null {
  const limpio = texto.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(limpio) ? limpio : null;
}

/** Motivo por el que no se puede cobrar con el POS, o null si se puede. */
export function motivoSinPos(
  pedido: PedidoPendienteDeCobro,
  posHabilitado: boolean,
): string | null {
  if (!posHabilitado) {
    return "El cobro con el POS del local no está habilitado en este establecimiento.";
  }
  if (pedido.pagoEnCurso) return MOTIVO_PAGO_EN_CURSO;
  return null;
}

/** Aviso después de registrar un cobro con el POS. */
export function mensajeCobroPosRegistrado(cobro: CobroPosRegistrado): string {
  const tarjeta =
    TARJETAS_POS.find((t) => t.codigo === cobro.tarjeta)?.nombre ?? "Tarjeta";
  const propina = hayPropina(cobro.propina)
    ? ` (incluye propina de ${formatearMonto(cobro.propina)})`
    : "";
  return `Cobro registrado: pedido ${codigoDelPedido(cobro.pedidoId)}, ${formatearMonto(cobro.monto)}${propina} con ${tarjeta.toLowerCase()} (autorización ${cobro.autorizacion}). Ya está en cocina.`;
}

/** Clave de idempotencia de un cobro con POS: una por diálogo abierto. */
export function nuevaClaveDeCobroPos(): string {
  return `pos-${crypto.randomUUID()}`;
}

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

/**
 * «$ 590» o «$ 590,50». Sin redondear los centésimos del vuelto. BL-398:
 * usa el mismo formato que la carta y el pago (antes mostraba «$ 10,5»).
 */
export function formatearMonto(valor: string | number): string {
  return formatearPrecio(valor);
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

/** El comensal tiene un pago con tarjeta en curso (cobrar y cancelar). */
const MOTIVO_PAGO_EN_CURSO =
  "El comensal está pagando con tarjeta. Si no se confirma, vence solo en unos minutos.";

/** Motivo por el que no se puede cobrar en efectivo, o null si se puede. */
export function motivoSinEfectivo(
  pedido: PedidoPendienteDeCobro,
  efectivoHabilitado: boolean,
): string | null {
  if (!efectivoHabilitado) {
    return "El cobro en efectivo no está habilitado en este establecimiento.";
  }
  if (pedido.pagoEnCurso) return MOTIVO_PAGO_EN_CURSO;
  return null;
}

/** Aviso después de cobrar. */
export function mensajeCobroRegistrado(cobro: CobroEfectivoRegistrado): string {
  const codigo = codigoDelPedido(cobro.pedidoId);
  const propina = hayPropina(cobro.propina)
    ? ` Propina: ${formatearMonto(cobro.propina)}.`
    : "";
  if (Number(cobro.vuelto) === 0) {
    return propina
      ? `Cobro registrado: pedido ${codigo}.${propina} Sin vuelto. Ya está en cocina.`
      : `Cobro registrado: pedido ${codigo}, sin vuelto. Ya está en cocina.`;
  }
  return `Cobro registrado: pedido ${codigo}.${propina} Vuelto: ${formatearMonto(cobro.vuelto)}. Ya está en cocina.`;
}

/**
 * Clave de idempotencia de un cobro: una por diálogo abierto. Si el mozo
 * hace doble clic o reintenta, se manda la misma y el backend no cobra dos
 * veces (RNF.03).
 */
export function nuevaClaveDeCobro(): string {
  return `efectivo-${crypto.randomUUID()}`;
}

/**
 * HU-031b (BL-442): marca de un pedido cuyo comensal avisó que paga en
 * efectivo, o null si no avisó.
 */
export function textoSolicitudEfectivo(
  pedido: PedidoPendienteDeCobro,
): string | null {
  const solicitud = pedido.efectivoSolicitado;
  if (!solicitud) return null;
  const pagaCon = solicitud.pagaCon
    ? ` · paga con ${formatearMonto(solicitud.pagaCon)}`
    : "";
  return `Pidió pagar en efectivo a las ${horaDelPedido(solicitud.en)}${pagaCon}`;
}

/** Lo que se precarga en «Monto recibido»: con cuánto dijo que paga. */
export function montoRecibidoInicial(pedido: PedidoPendienteDeCobro): string {
  return pedido.efectivoSolicitado?.pagaCon ?? "";
}

// ── HU-022 (BL-495): la propina que eligió el comensal ───────────────────

/** Hay propina si viene un monto mayor que cero. */
function hayPropina(propina: string | undefined): propina is string {
  return propina !== undefined && Number(propina) > 0;
}

/** Lo que el mozo ve del desglose del total de un pedido. */
export interface DesglosePropina {
  consumo: string;
  propina: string;
  /** «Propina (10 %)» o «Propina» si fue un monto libre. */
  etiqueta: string;
}

/**
 * Desglose de un pedido con propina, o null si no hay (el comensal no dejó
 * propina o el backend es anterior y no la informa).
 */
export function desglosePropina(
  pedido: PedidoPendienteDeCobro,
): DesglosePropina | null {
  if (!hayPropina(pedido.propina) || pedido.consumo === undefined) return null;
  const porcentaje = pedido.propinaPorcentaje;
  return {
    consumo: pedido.consumo,
    propina: pedido.propina,
    etiqueta:
      porcentaje === null || porcentaje === undefined
        ? "Propina"
        : `Propina (${porcentaje} %)`,
  };
}

/** «Incluye propina de $ 59 (10 %)» para la lista, o null si no hay. */
export function textoPropinaEnLista(
  pedido: PedidoPendienteDeCobro,
): string | null {
  const desglose = desglosePropina(pedido);
  if (!desglose) return null;
  const porcentaje =
    pedido.propinaPorcentaje === null || pedido.propinaPorcentaje === undefined
      ? ""
      : ` (${pedido.propinaPorcentaje} %)`;
  return `Incluye propina de ${formatearMonto(desglose.propina)}${porcentaje}`;
}

/**
 * El backend rechaza el cobro si el comensal cambió la propina después de
 * que el mozo abrió el pedido: el total ya no es el que está en pantalla.
 * Ese caso se resuelve actualizando la lista.
 */
export function esTotalCambiado(mensaje: string): boolean {
  return mensaje.startsWith("El total del pedido cambió");
}

// ── BL-501: cancelar un pedido que todavía no se cobró ─────────────────────

/** POST: cancela un pedido que espera el pago. */
export function rutaCancelarPendiente(pedidoId: string): string {
  return `${RUTA_PENDIENTES}/${encodeURIComponent(pedidoId)}/cancelar`;
}

/** Respuesta de la cancelación. */
export interface PendienteCancelado {
  pedidoId: string;
  estado: "CANCELADO";
  total: string;
}

/**
 * Por qué no se puede cancelar desde acá, o null si se puede. Con un pago
 * con tarjeta en curso, se espera a que se resuelva o venza (es el mismo
 * motivo que el del efectivo, así que se muestra una sola vez).
 */
export function motivoSinCancelar(
  pedido: PedidoPendienteDeCobro,
): string | null {
  return pedido.pagoEnCurso ? MOTIVO_PAGO_EN_CURSO : null;
}

/** Aviso después de cancelar. */
export function mensajePendienteCancelado(
  cancelado: PendienteCancelado,
): string {
  return `Pedido ${codigoDelPedido(cancelado.pedidoId)} cancelado. No se cobró y no pasa a cocina.`;
}

// ── BL-470: «Ir a cobrar» desde las alertas ────────────────────────────────

/** Pantalla de cobros pendientes y el parámetro con el pedido a destacar. */
export const RUTA_PANTALLA_COBROS = "/admin/cobros";
export const PARAM_PEDIDO = "pedido";

/** Adónde lleva «Ir a cobrar»: con el pedido, si el aviso lo trae. */
export function rutaCobrarPedido(pedidoId?: string): string {
  if (!pedidoId) return RUTA_PANTALLA_COBROS;
  return `${RUTA_PANTALLA_COBROS}?${PARAM_PEDIDO}=${encodeURIComponent(pedidoId)}`;
}

export const AVISO_PEDIDO_NO_PENDIENTE =
  "Ese pedido ya no está pendiente de cobro.";

/** Lo que se anuncia al llegar con un pedido destacado. */
export function anuncioPedidoDestacado(pedido: PedidoPendienteDeCobro): string {
  const lugar = pedido.mesa.esVirtual
    ? "para retirar"
    : `de la mesa ${pedido.mesa.numero}`;
  return `Pedido ${codigoDelPedido(pedido.id)} ${lugar}, esperando cobro.`;
}

export type PedidoDestacado =
  | { tipo: "ninguno" }
  | { tipo: "pendiente"; pedidoId: string; anuncio: string }
  | { tipo: "no-pendiente"; anuncio: string };

/**
 * Qué hacer con el `?pedido=` de la URL una vez cargada la lista. Si el
 * pedido sigue pendiente, se destaca; si no (ya se cobró, se canceló o no
 * existe), se avisa y no se destaca nada.
 */
export function resolverPedidoDestacado(
  pedidos: readonly PedidoPendienteDeCobro[],
  pedidoId: string | null,
): PedidoDestacado {
  if (!pedidoId) return { tipo: "ninguno" };
  const pedido = pedidos.find((p) => p.id === pedidoId);
  if (!pedido) {
    return { tipo: "no-pendiente", anuncio: AVISO_PEDIDO_NO_PENDIENTE };
  }
  return {
    tipo: "pendiente",
    pedidoId: pedido.id,
    anuncio: anuncioPedidoDestacado(pedido),
  };
}

/** HU-033 (BL-203): el link de pago que devuelve el backend al generarlo. */
export interface LinkPagoGenerado {
  url: string;
  venceEn: string;
}

/** HU-033 (BL-203): POST que genera (o reemplaza) el link de pago. */
export function rutaLinkPago(pedidoId: string): string {
  return `${RUTA_PENDIENTES}/${encodeURIComponent(pedidoId)}/link-pago`;
}

/**
 * HU-033 (BL-203): cuerpo del POST. `reemplazar` solo cuando el colaborador
 * vio el aviso de que hay un link activo y confirmó.
 */
export function cuerpoLinkPago(reemplazar: boolean): string {
  return JSON.stringify({ reemplazar });
}

/** 409 del backend: el pedido ya tiene un link activo que esta pantalla no conocía. */
export const CODIGO_LINK_ACTIVO = "LINK_PAGO_ACTIVO";

/** Aviso cuando otro colaborador generó el link (la lista estaba desactualizada). */
export const AVISO_OTRO_LINK =
  "Otro colaborador ya generó un link de pago para este pedido";

/**
 * HU-033 (BL-203): por qué no se puede generar el link. Con un pago con
 * tarjeta en curso, el comensal ya está pagando por otro lado.
 */
export function motivoSinLink(pedido: PedidoPendienteDeCobro): string | null {
  return pedido.pagoEnCurso ? MOTIVO_PAGO_EN_CURSO : null;
}

/** HU-033 (BL-203): «Link de pago activo hasta las 21:15», o null. */
export function textoLinkActivo(
  pedido: PedidoPendienteDeCobro,
  ahora: number = Date.now(),
): string | null {
  const vence = pedido.linkPagoVenceEn;
  if (!vence || Date.parse(vence) <= ahora) return null;
  return `Link de pago activo hasta las ${horaDelPedido(vence)}`;
}

/** HU-033 (BL-203): «Vence a las 21:15 (en 14 min)» o «Venció». */
export function textoVencimientoLink(venceEn: string, ahora: number): string {
  const restanMs = Date.parse(venceEn) - ahora;
  // Una fecha inválida (NaN) también cuenta como vencido.
  if (Number.isNaN(restanMs) || restanMs <= 0) {
    return "Este link venció. Generá otro.";
  }
  const minutos = Math.ceil(restanMs / 60_000);
  return `Vence a las ${horaDelPedido(venceEn)} (en ${minutos} min)`;
}
