import type { EstadoMesa } from "@/types/mesa";

/**
 * HU-017 (BL-60): sesión de la mesa desde el mapa de mesas. El mozo (o el
 * administrador) la abre al recibir comensales, la cierra cuando todo está
 * entregado y después la marca limpia. Lógica pura, separada del componente
 * para poder testearla.
 *
 *   LIBRE --abrir--> OCUPADA --cobro--> EN_PROCESO_DE_PAGO --> OCUPADA
 *   OCUPADA --cerrar--> REQUIERE_LIMPIEZA --limpia--> LIBRE
 */

export type AccionSesion = "abrir" | "cerrar" | "limpia";

export interface OpcionSesion {
  /** null: no hay nada que hacer ahora (por ejemplo, un cobro en curso). */
  readonly accion: AccionSesion | null;
  readonly etiqueta: string;
  readonly icono: string;
  readonly ayuda: string;
}

/** Qué puede hacer el mozo con la mesa según su estado. */
export function opcionSesion(estado: EstadoMesa): OpcionSesion {
  switch (estado) {
    case "LIBRE":
      return {
        accion: "abrir",
        etiqueta: "Abrir mesa",
        icono: "login",
        ayuda: "Al abrirla, el QR de la mesa sirve para pedir.",
      };
    case "OCUPADA":
      return {
        accion: "cerrar",
        etiqueta: "Cerrar mesa",
        icono: "logout",
        ayuda:
          "Solo con todos los pedidos entregados. Los que no se pagaron se cancelan.",
      };
    case "EN_PROCESO_DE_PAGO":
      return {
        accion: null,
        etiqueta: "Pago en curso",
        icono: "hourglass_top",
        ayuda: "Se puede cerrar cuando termine el cobro.",
      };
    case "REQUIERE_LIMPIEZA":
      return {
        accion: "limpia",
        etiqueta: "Marcar como limpia",
        icono: "cleaning_services",
        ayuda: "Después de limpiarla, la mesa vuelve a quedar libre.",
      };
  }
}

/** POST /mesas/:id/abrir | /cerrar | /limpia (MesasController). */
export function rutaAccionSesion(mesaId: string, accion: AccionSesion): string {
  return `/mesas/${encodeURIComponent(mesaId)}/${accion}`;
}

/** Aviso después de cerrar, según cuántos pedidos sin pagar se cancelaron. */
export function mensajeMesaCerrada(
  numero: number,
  pedidosCancelados: number,
): string {
  const base = `Mesa ${numero} cerrada.`;
  if (pedidosCancelados === 0) return base;
  return pedidosCancelados === 1
    ? `${base} Se canceló 1 pedido que no se había pagado.`
    : `${base} Se cancelaron ${pedidosCancelados} pedidos que no se habían pagado.`;
}

/** Roles que abren y cierran mesas (los mismos que exige el backend). */
export function puedeGestionarSesion(
  hasRole: (rol: string) => boolean,
): boolean {
  return hasRole("MOZO") || hasRole("ADMIN");
}
