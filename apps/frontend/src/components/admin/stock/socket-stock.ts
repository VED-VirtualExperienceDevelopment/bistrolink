import { io } from "socket.io-client";
import { esDesconexionInesperada } from "@/components/admin/mesas/mapa-mesas.utils";
import { crearRefrescoDiferido } from "@/components/admin/reportes/reportes.utils";
import type { AlertaStock } from "./stock.utils";

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
/** Espera desde el último evento antes de volver a pedir los datos. */
const DEMORA_RECARGA_MS = 1000;

export interface AvisosSocketStock {
  /** Cada `stock:alerta` (un pago que cruzó el umbral), al llegar. */
  alAlerta?: (alerta: AlertaStock) => void;
  /**
   * El stock cambió: después de `stock:alerta`, `stock:actualizado` o una
   * reconexión, una sola vez por ráfaga (1 s desde el último evento).
   */
  alCambiar: () => void;
}

/**
 * HU-015 (BL-120): escucha la sala de administradores del socket del staff.
 * La usan la campana del header y la pantalla «Stock de la jornada».
 * Devuelve la función que corta la conexión.
 */
export function abrirSocketStock(
  token: string,
  avisos: AvisosSocketStock,
): () => void {
  const recarga = crearRefrescoDiferido(avisos.alCambiar, DEMORA_RECARGA_MS);
  const socket = io(WS_URL, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  let huboConexion = false;

  socket.on("stock:alerta", (alerta: AlertaStock) => {
    avisos.alAlerta?.(alerta);
    recarga.programar();
  });
  socket.on("stock:actualizado", recarga.programar);
  // Al reconectar, trae lo que cambió mientras no había conexión.
  socket.on("connect", () => {
    if (huboConexion) recarga.programar();
    huboConexion = true;
  });
  socket.on("disconnect", (motivo) => {
    // Si lo cortó el servidor, socket.io no reintenta solo.
    if (esDesconexionInesperada(motivo) && motivo === "io server disconnect") {
      socket.connect();
    }
  });

  return () => {
    recarga.cancelar();
    socket.disconnect();
  };
}
