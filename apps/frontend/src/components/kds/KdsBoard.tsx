'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { useAlertas } from '@/components/alertas/AlertasProvider';
import { OrderTicket } from './OrderTicket';
import type { Pedido } from '@/types/pedido';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type EstadoPedido = Pedido['estado'];

interface PedidoActualizadoPayload {
  id: string;
  estado: EstadoPedido;
  actualizadoEn: string;
  mesaNumero?: number;
}

export function KdsBoard() {
  const { token, hasRole } = useKeycloakAuth();
  // BL-441: dentro de /admin/* el socket y las alertas vienen de
  // AlertasProvider (un solo socket del staff). El /kds de COCINA no tiene
  // ese proveedor y sigue abriendo el suyo.
  const alertas = useAlertas();
  const enShell = alertas !== null;
  const socketCompartido = alertas ? alertas.socket : null;
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conectadoPropio, setConectadoPropio] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const conectado = alertas ? alertas.conectado : conectadoPropio;
  // BL-460: este tablero solo muestra las comandas. Los llamados de mesa y los
  // avisos de pago en efectivo se atienden desde la campana y la pantalla
  // Alertas; el pedido listo se entrega con el botón de su comanda.

  const puedeOperarTransiciones = Boolean(hasRole('MOZO') || hasRole('ADMIN'));

  useEffect(() => {
    const propio = !enShell;
    let socket: Socket;
    if (propio) {
      if (!token) return;
      socket = io(WS_URL, {
        auth: { token },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });
    } else {
      // El socket compartido puede estar ya conectado: el servidor mandó el
      // estado inicial antes de que este tablero existiera, así que se lo
      // pedimos de nuevo (pedidos:sync). Si todavía no conectó, el servidor lo
      // manda solo al conectar.
      if (!socketCompartido) return;
      socket = socketCompartido;
    }
    socketRef.current = socket;

    const alSnapshotPedidos = (snapshot: Pedido[]) => {
      setPedidos(snapshot);
      setLoading(false);
    };

    const alPedidoNuevo = (pedido: Pedido) => {
      setPedidos((prev) => (prev.some((p) => p.id === pedido.id) ? prev : [...prev, pedido]));
    };

    const alPedidoActualizado = (payload: PedidoActualizadoPayload) => {
      setPedidos((prev) => {
        // HU-018/BL-64: una vez entregado, el pedido sale del tablero
        // activo — mismo criterio que listarPendientes() ya aplica del
        // lado del backend para el snapshot de reconexión.
        if (payload.estado === 'ENTREGADO') {
          return prev.filter((p) => p.id !== payload.id);
        }
        return prev.map((p) =>
          p.id === payload.id ? { ...p, estado: payload.estado } : p,
        );
      });
    };

    const alError = (err: { message: string }) => {
      setLoadError(err.message);
      setLoading(false);
    };

    socket.on('pedidos:snapshot', alSnapshotPedidos);
    socket.on('pedido:nuevo', alPedidoNuevo);
    socket.on('pedido:actualizado', alPedidoActualizado);
    socket.on('error', alError);

    // Solo el /kds de COCINA maneja su propia conexión.
    const alConectar = () => setConectadoPropio(true);
    const alDesconectar = () => setConectadoPropio(false);

    if (propio) {
      socket.on('connect', alConectar);
      socket.on('disconnect', alDesconectar);
    } else if (socket.connected) {
      socket.emit('pedidos:sync');
    }

    return () => {
      socket.off('pedidos:snapshot', alSnapshotPedidos);
      socket.off('pedido:nuevo', alPedidoNuevo);
      socket.off('pedido:actualizado', alPedidoActualizado);
      socket.off('error', alError);
      if (propio) {
        socket.off('connect', alConectar);
        socket.off('disconnect', alDesconectar);
        // El socket compartido lo cierra AlertasProvider, no este tablero.
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [enShell, socketCompartido, token]);

  function emitirTransicion(pedidoId: string, nuevoEstado: EstadoPedido) {
    socketRef.current?.emit('pedido:transicion', { pedidoId, nuevoEstado });
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
      {!conectado && !loading && (
        <div role="status" className="shrink-0 rounded-lg bg-tertiary-container px-3 py-1.5 text-label-md text-on-tertiary-container">
          Reconectando…
        </div>
      )}
      {contenido}
    </div>
  );
}
