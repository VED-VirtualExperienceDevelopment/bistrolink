'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { OrderTicket } from './OrderTicket';
import type { Pedido } from '@/types/pedido';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type EstadoPedido = Pedido['estado'];

interface PedidoActualizadoPayload {
  id: string;
  estado: EstadoPedido;
  actualizadoEn: string;
}

interface LlamadoMozo {
  mesaId: string;
  mesaNumero: number;
  ts: number;
}

export function KdsBoard() {
  const { token, hasRole } = useKeycloakAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conectado, setConectado] = useState(false);
  const [llamados, setLlamados] = useState<LlamadoMozo[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const puedeOperarTransiciones = Boolean(hasRole('MOZO') || hasRole('ADMIN'));

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

    // HU-019/BL-68
    socket.on('llamado:nuevo', (llamado: LlamadoMozo) => {
      setLlamados((prev) =>
        prev.some((l) => l.mesaId === llamado.mesaId) ? prev : [...prev, llamado],
      );
    });

    socket.on('llamado:resuelto', ({ mesaId }: { mesaId: string }) => {
      setLlamados((prev) => prev.filter((l) => l.mesaId !== mesaId));
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

  function resolverLlamado(mesaId: string, accion: 'aceptado' | 'desestimado') {
    socketRef.current?.emit('llamado:resolver', { mesaId, accion });
  }

  const gruposPorMesa = (() => {
    const mapa = new Map<number, Pedido[]>();
    for (const pedido of pedidos) {
      const grupo = mapa.get(pedido.mesaNumero) ?? [];
      grupo.push(pedido);
      mapa.set(pedido.mesaNumero, grupo);
    }
    return [...mapa.entries()]
      .map(([mesaNumero, pedidosDeLaMesa]) => ({
        mesaNumero,
        pedidos: [...pedidosDeLaMesa].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      }))
      .sort(
        (a, b) =>
          new Date(a.pedidos[0].createdAt).getTime() -
          new Date(b.pedidos[0].createdAt).getTime(),
      );
  })();

  const banner = llamados.length > 0 && (
    <div className="flex shrink-0 flex-col gap-1.5">
      {llamados.map((llamado) => (
        <div
          key={llamado.mesaId}
          role="alert"
          className="flex items-center justify-between rounded-lg bg-tertiary-container px-3 py-2 text-label-md text-on-tertiary-container"
        >
          <span>🔔 Mesa {llamado.mesaNumero} solicita atención</span>
          {puedeOperarTransiciones && (
            <div className="flex gap-2">
              <button
                onClick={() => resolverLlamado(llamado.mesaId, 'aceptado')}
                className="rounded-md bg-primary px-2 py-1 text-white"
              >
                Aceptar
              </button>
              <button
                onClick={() => resolverLlamado(llamado.mesaId, 'desestimado')}
                className="rounded-md border border-outline px-2 py-1"
              >
                Desestimar
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  let contenido;
  if (loading) {
    contenido = (
      <div className="flex flex-1 items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  } else if (loadError) {
    contenido = (
      <div role="alert" className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
        {loadError}
      </div>
    );
  } else if (pedidos.length === 0) {
    contenido = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-body-md text-on-surface-variant">
        <span>No hay pedidos activos en este momento.</span>
        {!conectado && (
          <span className="text-label-md text-error">Reconectando con el servidor…</span>
        )}
      </div>
    );
  } else {
    contenido = (
      <div className="flex h-full gap-gutter overflow-x-auto overflow-y-hidden pb-4">
        {gruposPorMesa.map(({ mesaNumero, pedidos: pedidosDeLaMesa }) => (
          <div key={mesaNumero} className="flex h-full shrink-0 flex-col gap-1.5">
            {pedidosDeLaMesa.length > 1 && (
              <div className="shrink-0 rounded-md bg-surface-container-low px-2 py-1 text-label-sm font-semibold text-on-surface-variant">
                Mesa {mesaNumero} · {pedidosDeLaMesa.length} pedidos
              </div>
            )}
            <div className="flex h-full gap-gutter">
              {pedidosDeLaMesa.map((pedido) => (
                <OrderTicket
                  key={pedido.id}
                  pedido={pedido}
                  puedeOperarTransiciones={puedeOperarTransiciones}
                  onTransicion={emitirTransicion}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {banner}
      {!conectado && !loading && (
        <div role="status" className="shrink-0 rounded-lg bg-tertiary-container px-3 py-1.5 text-label-md text-on-tertiary-container">
          Reconectando…
        </div>
      )}
      {contenido}
    </div>
  );
}