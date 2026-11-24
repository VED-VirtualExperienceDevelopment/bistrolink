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
 *
 * BL-515: el servidor verifica el token en cada conexión y toma el tenant del
 * token, así que ya no se manda el tenantId. `auth` es una función: Socket.io
 * la llama en cada intento de conexión, y así una reconexión usa el token
 * vigente (Keycloak lo renueva) y no el del momento en que se abrió el
 * socket.
 */
export function getMenuSocket(obtenerToken: () => string | undefined): Socket {
  if (socketInstance?.connected || socketInstance?.active) {
    return socketInstance;
  }

  if (socketInstance) {
    socketInstance.disconnect();
  }

  socketInstance = io(`${SOCKET_URL}/menu`, {
    auth: (cb) => cb({ token: obtenerToken() }),
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
    // BL-515: si el servidor rechazó el handshake (token vencido o sin
    // permiso), Socket.io no reintenta solo (`active` en false). Se vuelve a
    // intentar a los 10 segundos, con el token que haya en ese momento.
    const socket = socketInstance;
    if (socket && !socket.active) {
      setTimeout(() => {
        if (socketInstance === socket && !socket.connected) socket.connect();
      }, 10000);
    }
  });

  return socketInstance;
}

export function disconnectMenuSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
