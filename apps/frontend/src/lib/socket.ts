import { io, Socket } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace("/api", "") ||
  "http://localhost:3001";

let socketInstance: Socket | null = null;

/**
 * Socket del menú (Gestión de Carta). Uno solo por pestaña.
 *
 * BL-398: si ya hay uno conectado o intentando conectarse (`active`), se
 * reutiliza. Antes se cerraba y se creaba otro cuando todavía estaba
 * conectándose (por ejemplo, con el doble montaje de React en desarrollo),
 * y eso daba «websocket error» de a ratos.
 */
export function getMenuSocket(tenantId: string, token?: string): Socket {
  if (socketInstance?.connected || socketInstance?.active) {
    return socketInstance;
  }

  if (socketInstance) {
    socketInstance.disconnect();
  }

  socketInstance = io(`${SOCKET_URL}/menu`, {
    auth: token ? { token } : undefined,
    query: { tenantId },
    transports: ["websocket", "polling"],
    // BL-398: reintenta sin límite (antes paraba a los 5 intentos y el aviso
    // «Reconectando…» de la pantalla quedaba mintiendo), con espera
    // creciente de 1 a 10 segundos.
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socketInstance.on("connect", () => {
    console.log("[Socket] Conectado al menú:", socketInstance?.id);
  });

  socketInstance.on("disconnect", () => {
    console.log("[Socket] Desconectado del menú");
  });

  // BL-398: advertencia y no error. Un corte de conexión es esperable y la
  // pantalla ya lo avisa («Sin conexión en tiempo real»); con console.error,
  // Next.js abría su ventana de error en desarrollo en cada reintento.
  socketInstance.on("connect_error", (error) => {
    console.warn("[Socket] Error de conexión:", error.message);
  });

  return socketInstance;
}

export function disconnectMenuSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
