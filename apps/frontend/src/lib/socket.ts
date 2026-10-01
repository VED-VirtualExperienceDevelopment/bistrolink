import { io, Socket } from 'socket.io-client';

const SOCKET_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') ||
  'http://localhost:3001';

let socketInstance: Socket | null = null;

export function getMenuSocket(tenantId: string, token?: string): Socket {
  if (socketInstance?.connected) {
    return socketInstance;
  }

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

export function disconnectMenuSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
