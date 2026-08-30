'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { OrderTicket } from './OrderTicket';
import type { Pedido } from '@/types/pedido';

// URL del backend para el canal WS del KDS. Reusa el mismo host que
// NEXT_PUBLIC_API_URL (variable ya existente para el cliente REST en
// lib/api-client) — ajustar el nombre si el proyecto usa otra convención.
const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type EstadoPedido = Pedido['estado'];

interface PedidoActualizadoPayload {
  id: string;
  estado: EstadoPedido;
  actualizadoEn: string;
}

export function KdsBoard() {
  const { token, hasRole } = useKeycloakAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conectado, setConectado] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // RD.06: Cocina es de solo lectura — solo Mozo/Administrador pueden
  // operar transiciones. El backend rechaza igual el evento si el rol no
  // corresponde; esto es defensa en profundidad del lado de la UI, no la
  // única validación.
  const puedeOperarTransiciones = Boolean(hasRole('MOZO') || hasRole('ADMIN'));

  // Conexión WebSocket (HU-004). No hay fetch REST inicial: el propio
  // servidor manda 'pedidos:snapshot' apenas la conexión se autentica, y
  // de nuevo tras cada reconexión — eso ya cubre tanto la carga inicial
  // como la recuperación ante un corte, sin necesitar un endpoint REST
  // aparte (que además no existe: /pedidos/activos no está implementado).
  useEffect(() => {
    if (!token) return;

    const socket = io(WS_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConectado(true));
    socket.on('disconnect', () => setConectado(false));

    socket.on('pedidos:snapshot', (snapshot: Pedido[]) => {
      setPedidos(snapshot);
      setLoading(false);
    });

    socket.on('pedido:nuevo', (pedido: Pedido) => {
      setPedidos((prev) => (prev.some((p) => p.id === pedido.id) ? prev : [...prev, pedido]));
    });

    socket.on('pedido:actualizado', (payload: PedidoActualizadoPayload) => {
      setPedidos((prev) =>
        prev.map((p) => (p.id === payload.id ? { ...p, estado: payload.estado } : p)),
      );
    });

    socket.on('error', (err: { message: string }) => {
      setLoadError(err.message);
      setLoading(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  function emitirTransicion(pedidoId: string, nuevoEstado: EstadoPedido) {
    socketRef.current?.emit('pedido:transicion', { pedidoId, nuevoEstado });
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
        {loadError}
      </div>
    );
  }

  if (pedidos.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-body-md text-on-surface-variant">
        <span>No hay pedidos activos en este momento.</span>
        {!conectado && (
          <span className="text-label-md text-error">Reconectando con el servidor…</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {!conectado && (
        <div role="status" className="shrink-0 rounded-lg bg-tertiary-container px-3 py-1.5 text-label-md text-on-tertiary-container">
          Reconectando…
        </div>
      )}
      <div className="flex h-full gap-gutter overflow-x-auto overflow-y-hidden pb-4">
        {pedidos.map((pedido) => (
          <OrderTicket
            key={pedido.id}
            pedido={pedido}
            puedeOperarTransiciones={puedeOperarTransiciones}
            onTransicion={emitirTransicion}
          />
        ))}
      </div>
    </div>
  );
}
