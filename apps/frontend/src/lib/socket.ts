import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3001';

let socketInstance: Socket | null = null;

/**
 * Obtiene o crea la instancia del WebSocket para el menú.
 * Se conecta al namespace '/menu' y pasa el token de Keycloak para autenticación.
 * 
 * @param tenantId - El ID del tenant para unirse a la sala correcta
 * @param token - El token JWT de Keycloak
 */
export function getMenuSocket(tenantId: string, token?: string): Socket {
  // Si ya existe una conexión y es la misma, la reutilizamos
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  // Si hay una instancia desconectada, la limpiamos
  if (socketInstance) {
    socketInstance.disconnect();
  }

  socketInstance = io(`${SOCKET_URL}/menu`, {
    auth: token ? { token } : undefined,
    query: { tenantId },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socketInstance.on('connect', () => {
    console.log('[Socket] Conectado al menú:', socketInstance?.id);
  });

  socketInstance.on('disconnect', () => {
    console.log('[Socket] Desconectado del menú');
  });

  socketInstance.on('connect_error', (error) => {
    console.error('[Socket] Error de conexión:', error.message);
  });

  return socketInstance;
}

/**
 * Cierra la conexión del WebSocket y limpia la instancia.
 */
export function disconnectMenuSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
