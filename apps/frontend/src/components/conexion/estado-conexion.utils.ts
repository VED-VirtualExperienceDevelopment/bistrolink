/**
 * HU-038 (BL-504): estado de la conexión en tiempo real (socket) que ven el
 * KDS, el mapa de mesas y el seguimiento del comensal.
 * Lógica pura (probada en test/unitarios/estado-conexion.utils.spec.ts).
 *
 * Estados:
 * - conectando: todavía no se conectó nunca (al abrir la pantalla).
 * - conectado: hay conexión.
 * - reconectando: se perdió la conexión y socket.io está reintentando.
 * - desconectado: pasó DEMORA_DESCONECTADO_MS sin poder conectar, o el
 *   navegador quedó sin red. socket.io sigue reintentando: si vuelve, pasa
 *   a «conectado».
 */

export type EstadoConexion =
  "conectando" | "conectado" | "reconectando" | "desconectado";

/** Lo que le puede pasar a la conexión. */
export type EventoConexion =
  /** El socket se conectó. */
  | "conectado"
  /** Se cortó o falló el intento de conexión. */
  | "perdido"
  /** El navegador avisó que no hay red (evento `offline`). */
  | "sin-red"
  /** El navegador avisó que volvió la red (evento `online`). */
  | "con-red"
  /** Pasó DEMORA_DESCONECTADO_MS sin poder conectar. */
  | "demora-vencida";

/** Cuánto se espera reconectando antes de mostrar «Desconectado». */
export const DEMORA_DESCONECTADO_MS = 30_000;

export const TEXTO_ESTADO_CONEXION: Readonly<Record<EstadoConexion, string>> = {
  conectando: "Conectando…",
  conectado: "Conectado",
  reconectando: "Reconectando…",
  desconectado: "Desconectado",
};

/** Próximo estado según lo que pasó (reducer de useEstadoConexion). */
export function siguienteEstadoConexion(
  estado: EstadoConexion,
  evento: EventoConexion,
): EstadoConexion {
  switch (evento) {
    case "conectado":
      return "conectado";
    case "perdido":
      // Si ya está desconectado, un intento fallido más no cambia nada. Si
      // todavía no se conectó nunca, sigue «conectando».
      if (estado === "desconectado" || estado === "conectando") return estado;
      return "reconectando";
    case "sin-red":
      return "desconectado";
    case "con-red":
      // Volvió la red: socket.io reintenta. Hasta que conecte, «reconectando».
      return estado === "conectado" ? estado : "reconectando";
    case "demora-vencida":
      return estado === "conectando" || estado === "reconectando"
        ? "desconectado"
        : estado;
  }
}

/** Si en este estado hay que contar la demora hasta «desconectado». */
export function esperaConexion(estado: EstadoConexion): boolean {
  return estado === "conectando" || estado === "reconectando";
}
