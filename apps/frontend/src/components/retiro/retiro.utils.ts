/**
 * HU-040 (BL-210): pedidos para retirar (el enlace web del local).
 *
 * Lógica pura, con test (test/unitarios/retiro.utils.spec.ts). El backend
 * aplica las mismas reglas: esto solo evita mandar algo que se va a
 * rechazar y arma los textos de la pantalla.
 */

/** Código de error de POST /pedidos si el local no toma pedidos ahora. */
export const CODIGO_RETIRO_NO_DISPONIBLE = "RETIRO_NO_DISPONIBLE";

/** Bloque `retiro` de GET /menu/tenant/:t/restaurante/:r. */
export interface RetiroPublico {
  habilitado: boolean;
  /** Si en este momento se puede pedir (habilitado y dentro del horario). */
  abierto: boolean;
  horaDesde: string | null;
  horaHasta: string | null;
}

/** Lo que completa el comensal en el carrito (todo opcional). */
export interface FormularioContactoRetiro {
  nombre: string;
  contacto: string;
  consentimiento: boolean;
}

/** Cuerpo `contactoRetiro` de POST /pedidos. */
export interface ContactoRetiro {
  nombre: string;
  contacto: string;
  consentimiento: true;
}

export const CONTACTO_RETIRO_VACIO: FormularioContactoRetiro = {
  nombre: "",
  contacto: "",
  consentimiento: false,
};

export const LARGO_MAXIMO_NOMBRE_RETIRO = 60;
export const LARGO_MAXIMO_CONTACTO_RETIRO = 100;

/** Por qué no se puede pedir ahora, o null si se puede. */
export function avisoRetiroCerrado(
  retiro: RetiroPublico | null | undefined,
): string | null {
  if (!retiro || retiro.abierto) return null;
  if (!retiro.habilitado) {
    return "Este local no está tomando pedidos para retirar en este momento.";
  }
  if (retiro.horaDesde && retiro.horaHasta) {
    return `Este local toma pedidos para retirar de ${retiro.horaDesde} a ${retiro.horaHasta}. Podés ver la carta, pero todavía no pedir.`;
  }
  return "Este local no está tomando pedidos para retirar en este momento.";
}

/**
 * Error del formulario de contacto, o null si está bien. Vacío está bien
 * (es opcional); si completó algo, tienen que estar el nombre, el contacto y
 * el consentimiento.
 */
export function errorContactoRetiro(
  formulario: FormularioContactoRetiro,
): string | null {
  const nombre = formulario.nombre.trim();
  const contacto = formulario.contacto.trim();
  if (!nombre && !contacto) return null;
  if (!nombre) return "Escribí tu nombre o dejá los dos campos vacíos.";
  if (normalizarContactoRetiro(contacto).length < 3) {
    return "Escribí un teléfono o un correo, o dejá los dos campos vacíos.";
  }
  if (nombre.length > LARGO_MAXIMO_NOMBRE_RETIRO) {
    return `El nombre puede tener hasta ${LARGO_MAXIMO_NOMBRE_RETIRO} caracteres.`;
  }
  if (contacto.length > LARGO_MAXIMO_CONTACTO_RETIRO) {
    return `El contacto puede tener hasta ${LARGO_MAXIMO_CONTACTO_RETIRO} caracteres.`;
  }
  if (!formulario.consentimiento) {
    return "Para guardar tu nombre y tu contacto, marcá que estás de acuerdo.";
  }
  return null;
}

/**
 * Mismo criterio que el backend (normalizarContactoRetiro): un correo en
 * minúsculas; un teléfono, solo los dígitos (y el + del prefijo). Así el
 * administrador lo encuentra para anonimizarlo aunque lo escriba distinto.
 */
export function normalizarContactoRetiro(contacto: string): string {
  const limpio = contacto.trim();
  if (limpio.includes("@")) return limpio.toLowerCase();
  const signo = limpio.startsWith("+") ? "+" : "";
  return signo + limpio.replaceAll(/\D/g, "");
}

/** Lo que se manda en POST /pedidos, o undefined si no completó nada. */
export function contactoParaEnviar(
  formulario: FormularioContactoRetiro,
): ContactoRetiro | undefined {
  const nombre = formulario.nombre.trim();
  const contacto = formulario.contacto.trim();
  if (!nombre || !contacto || !formulario.consentimiento) return undefined;
  return { nombre, contacto, consentimiento: true };
}

/**
 * Para reusar el pedido creado si el comensal vuelve a la carta: si cambió
 * el contacto, es otro pedido.
 */
export function firmaContactoRetiro(contacto: ContactoRetiro | undefined) {
  return contacto ? `|${contacto.nombre}|${contacto.contacto}` : "";
}

/** «R-042» tal como lo escribe el colaborador, o null si no tiene esa forma. */
export function normalizarCodigoRetiro(texto: string): string | null {
  const limpio = texto.trim().toUpperCase();
  const sinPrefijo = limpio.startsWith("R")
    ? limpio.slice(1).replace(/^[\s-]*/, "")
    : limpio;
  if (!/^\d{1,3}$/.test(sinPrefijo)) return null;
  const numero = Number(sinPrefijo);
  if (numero < 1) return null;
  return `R-${String(numero).padStart(3, "0")}`;
}

/** Ruta del endpoint de entrega con código. */
export function rutaEntregarRetiro(pedidoId: string): string {
  return `/pedidos/${encodeURIComponent(pedidoId)}/entregar-retiro`;
}

/** Encabezado de la comanda: «Para retirar · R-042» o «Mesa 3». */
export function lugarDelPedido(pedido: {
  mesaNumero: number;
  retiro?: { codigo: string } | null;
}): string {
  return pedido.retiro
    ? `Para retirar · ${pedido.retiro.codigo}`
    : `Mesa ${pedido.mesaNumero}`;
}

/** Texto del aviso del navegador cuando el pedido está listo. */
export function textoAvisoListo(codigo: string | null): {
  titulo: string;
  cuerpo: string;
} {
  return {
    titulo: "Tu pedido está listo",
    cuerpo: codigo
      ? `Retiralo en el mostrador con el código ${codigo}.`
      : "Retiralo en el mostrador.",
  };
}

export type PermisoAviso = "no-soportado" | "default" | "granted" | "denied";

/** Estado del permiso de notificaciones del navegador. */
export function permisoDeAviso(
  ventana: { Notification?: { permission: string } } | undefined,
): PermisoAviso {
  const permiso = ventana?.Notification?.permission;
  if (permiso === "default" || permiso === "granted" || permiso === "denied") {
    return permiso;
  }
  return "no-soportado";
}
