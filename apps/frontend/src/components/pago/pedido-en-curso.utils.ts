/**
 * BL-448: retomar el pedido en curso al recargar la página.
 *
 * La carta (MenuDigital) tiene en memoria el pedido que se está pagando; con
 * una recarga se perdía y el comensal volvía a la carta (y podía duplicar el
 * pedido). Ahora se guarda lo mínimo en sessionStorage (por pestaña) y, al
 * volver a abrir la carta, se consulta el estado real del pedido.
 *
 * Qué se guarda: id del pedido, firma y líneas del carrito, nota general y,
 * solo en un pedido para retirar, su token de acceso (RD.05: sin él no se
 * puede consultar ni pagar). Nunca el JWT del comensal (se pide uno nuevo) ni
 * datos de tarjeta.
 *
 * Lógica pura, probada en test/unitarios/pedido-en-curso.utils.spec.ts.
 */
import type { OrigenMenu } from "@/components/menu-digital.utils";
import {
  CODIGO_MESA_CERRADA,
  CODIGO_SESION_VENCIDA,
  MENSAJE_MESA_CERRADA,
  MENSAJE_SESION_VENCIDA,
} from "@/components/menu-digital.utils";
import type { EstadoPagoDelPedido } from "./pago.utils";

const PREFIJO_CLAVE = "bistrolink:pedido-en-curso";
const VERSION = 1;

/** Línea del carrito, como la tiene MenuDigital. */
export interface LineaGuardada {
  itemCartaId: string;
  nombre: string;
  precio: number;
  cantidad: number;
  imagenUrl: string | null;
  observacion?: string;
}

export interface PedidoEnCurso {
  pedidoId: string;
  /** Solo pedidos para retirar. */
  tokenAcceso?: string;
  firma: string;
  lineas: LineaGuardada[];
  observacionGeneral: string;
  /** El pago ya se aprobó: al recargar se vuelve a la confirmación. */
  aprobado?: boolean;
}

/** Almacenamiento mínimo (sessionStorage en el navegador, un Map en los tests). */
export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

/**
 * Una entrada por mesa (el QR identifica la mesa) o por local para retirar.
 * Así, en la misma pestaña, el pedido de una mesa no aparece en otra.
 */
export function clavePedidoEnCurso(origen: OrigenMenu): string {
  return origen.tipo === "mesa"
    ? `${PREFIJO_CLAVE}:mesa:${origen.qrToken}`
    : `${PREFIJO_CLAVE}:web:${origen.restauranteId}`;
}

/** sessionStorage, o null si no hay (SSR) o el navegador lo bloquea. */
export function almacenDelNavegador(): Almacen | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function esLinea(valor: unknown): valor is LineaGuardada {
  if (typeof valor !== "object" || valor === null) return false;
  const l = valor as Record<string, unknown>;
  return (
    typeof l.itemCartaId === "string" &&
    typeof l.nombre === "string" &&
    typeof l.precio === "number" &&
    typeof l.cantidad === "number" &&
    (l.imagenUrl === null || typeof l.imagenUrl === "string") &&
    (l.observacion === undefined || typeof l.observacion === "string")
  );
}

/**
 * Lo guardado, o null si no hay nada o no se puede usar (otra versión,
 * datos rotos, almacenamiento bloqueado). Nunca lanza.
 */
export function leerPedidoEnCurso(
  almacen: Almacen | null,
  clave: string,
): PedidoEnCurso | null {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(clave);
    if (!crudo) return null;
    const datos = JSON.parse(crudo) as Record<string, unknown>;
    if (
      datos.v !== VERSION ||
      typeof datos.pedidoId !== "string" ||
      typeof datos.firma !== "string" ||
      typeof datos.observacionGeneral !== "string" ||
      !Array.isArray(datos.lineas) ||
      !datos.lineas.every(esLinea) ||
      (datos.tokenAcceso !== undefined && typeof datos.tokenAcceso !== "string")
    ) {
      almacen.removeItem(clave);
      return null;
    }
    return {
      pedidoId: datos.pedidoId,
      tokenAcceso: datos.tokenAcceso as string | undefined,
      firma: datos.firma,
      lineas: datos.lineas,
      observacionGeneral: datos.observacionGeneral,
      aprobado: datos.aprobado === true,
    };
  } catch {
    return null;
  }
}

/**
 * Guarda el pedido en curso. Solo los campos de la lista: aunque llegue otro
 * dato (por ejemplo, el JWT), no se escribe. Si el navegador no deja
 * guardar, se sigue sin retomar.
 */
export function guardarPedidoEnCurso(
  almacen: Almacen | null,
  clave: string,
  pedido: PedidoEnCurso,
): void {
  if (!almacen) return;
  const datos = {
    v: VERSION,
    pedidoId: pedido.pedidoId,
    ...(pedido.tokenAcceso ? { tokenAcceso: pedido.tokenAcceso } : {}),
    firma: pedido.firma,
    lineas: pedido.lineas.map((l) => ({
      itemCartaId: l.itemCartaId,
      nombre: l.nombre,
      precio: l.precio,
      cantidad: l.cantidad,
      imagenUrl: l.imagenUrl,
      ...(l.observacion ? { observacion: l.observacion } : {}),
    })),
    observacionGeneral: pedido.observacionGeneral,
    ...(pedido.aprobado ? { aprobado: true } : {}),
  };
  try {
    almacen.setItem(clave, JSON.stringify(datos));
  } catch {
    // Almacenamiento lleno o bloqueado: no se puede retomar, nada más.
  }
}

export function borrarPedidoEnCurso(
  almacen: Almacen | null,
  clave: string,
): void {
  try {
    almacen?.removeItem(clave);
  } catch {
    // Nada que hacer.
  }
}

/** Estados en los que el pedido ya se pagó (llegó a cocina o después). */
const ESTADOS_PAGADOS = new Set([
  "RECIBIDO",
  "EN_PREPARACION",
  "LISTO_PARA_ENTREGAR",
  "ENTREGADO",
]);

export const MENSAJE_PEDIDO_CANCELADO =
  "Tu pedido anterior se canceló. Si querés, hacé uno nuevo.";
export const MENSAJE_PEDIDO_NO_DISPONIBLE =
  "No encontramos tu pedido anterior. Si querés, hacé uno nuevo.";

export type Retoma =
  /** Sigue esperando el pago: pantalla de pago del mismo pedido (o «Esperando al mozo»). */
  | { accion: "pago" }
  /** Ya se pagó: «¡Tu pedido ya está en cocina!» con el comprobante. */
  | { accion: "aprobado" }
  /** No se puede retomar: se borra lo guardado y se avisa en la carta. */
  | { accion: "descartar"; aviso: string }
  /** No se supo (red, servidor): se muestra la carta y se conserva para la próxima. */
  | { accion: "conservar" };

/** Qué hacer con el pedido guardado según GET /pedidos/:id/pagos. */
export function decidirRetoma(
  estado: Pick<EstadoPagoDelPedido, "estadoPedido" | "pago">,
): Retoma {
  if (estado.estadoPedido === "PENDIENTE_PAGO") {
    // Un pago con tarjeta aprobado que todavía no movió el pedido: ya está.
    return estado.pago?.estado === "APROBADO"
      ? { accion: "aprobado" }
      : { accion: "pago" };
  }
  if (ESTADOS_PAGADOS.has(estado.estadoPedido)) {
    return { accion: "aprobado" };
  }
  if (estado.estadoPedido === "CANCELADO") {
    return { accion: "descartar", aviso: MENSAJE_PEDIDO_CANCELADO };
  }
  return { accion: "descartar", aviso: MENSAJE_PEDIDO_NO_DISPONIBLE };
}

function avisoDe410(codigo?: string): string {
  if (codigo === CODIGO_MESA_CERRADA) return MENSAJE_MESA_CERRADA;
  if (codigo === CODIGO_SESION_VENCIDA) return MENSAJE_SESION_VENCIDA;
  return MENSAJE_PEDIDO_NO_DISPONIBLE;
}

/**
 * Qué hacer si la consulta (o la identificación del comensal) falló:
 * 410 = la mesa se cerró o su sesión terminó; 400/403/404 = el pedido ya no
 * es accesible o no existe. Cualquier otro error (sin red, 5xx) no prueba
 * nada: se conserva para intentar en la próxima carga.
 */
export function retomaDeError(status: number, codigo?: string): Retoma {
  if (status === 410) {
    return { accion: "descartar", aviso: avisoDe410(codigo) };
  }
  if (status === 400 || status === 403 || status === 404) {
    return { accion: "descartar", aviso: MENSAJE_PEDIDO_NO_DISPONIBLE };
  }
  return { accion: "conservar" };
}
