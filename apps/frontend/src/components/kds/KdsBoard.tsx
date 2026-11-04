'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { useAlertas } from '@/components/alertas/AlertasProvider';
import { OrderTicket } from './OrderTicket';
import type { Pedido } from '@/types/pedido';
import {
  agregarLlamado,
  llamadosDelSnapshot,
  quitarLlamadoDePedido,
  textoLlamado,
  type LlamadoMozo,
} from './llamado.utils';

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
  const [llamadosPropios, setLlamadosPropios] = useState<LlamadoMozo[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const conectado = alertas ? alertas.conectado : conectadoPropio;
  const llamados = alertas ? alertas.llamados : llamadosPropios;

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
      // BL-448: si era el pedido de un aviso de efectivo, ya se cobró. Dentro
      // de /admin/* lo resuelve AlertasProvider.
      if (propio) {
        setLlamadosPropios((prev) => quitarLlamadoDePedido(prev, pedido.id));
      }
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

    // Solo el /kds de COCINA maneja sus propios llamados y su conexión.
    const alConectar = () => setConectadoPropio(true);
    const alDesconectar = () => setConectadoPropio(false);
    // HU-019/BL-68
    const alLlamadoNuevo = (llamado: LlamadoMozo) => {
      setLlamadosPropios((prev) => agregarLlamado(prev, llamado));
    };
    // BL-441: alertas pendientes, al conectar o reconectar. Reemplazan a las
    // que había: el servidor sabe cuáles siguen sin atender.
    const alSnapshotLlamados = (snapshot: LlamadoMozo[]) => {
      setLlamadosPropios(llamadosDelSnapshot(snapshot));
    };
    const alLlamadoResuelto = ({ mesaId }: { mesaId: string }) => {
      setLlamadosPropios((prev) => prev.filter((l) => l.mesaId !== mesaId));
    };

    if (propio) {
      socket.on('connect', alConectar);
      socket.on('disconnect', alDesconectar);
      socket.on('llamado:nuevo', alLlamadoNuevo);
      socket.on('llamados:snapshot', alSnapshotLlamados);
      socket.on('llamado:resuelto', alLlamadoResuelto);
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
        socket.off('llamado:nuevo', alLlamadoNuevo);
        socket.off('llamados:snapshot', alSnapshotLlamados);
        socket.off('llamado:resuelto', alLlamadoResuelto);
        // El socket compartido lo cierra AlertasProvider, no este tablero.
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [enShell, socketCompartido, token]);

  function emitirTransicion(pedidoId: string, nuevoEstado: EstadoPedido) {
    socketRef.current?.emit('pedido:transicion', { pedidoId, nuevoEstado });
  }

  function resolverLlamado(mesaId: string, accion: 'aceptado' | 'desestimado') {
    if (alertas) {
      alertas.resolver(mesaId, accion);
      return;
    }
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
          <span>{textoLlamado(llamado)}</span>
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

  const pedidosListos = pedidos.filter((p) => p.estado === 'LISTO_PARA_ENTREGAR');

  const bannerListos = pedidosListos.length > 0 && (
    <div className="flex shrink-0 flex-col gap-1.5">
      {pedidosListos.map((pedido) => (
        <div
          key={pedido.id}
          data-pedido-id={pedido.id}
          role="alert"
          className="flex items-center justify-between rounded-lg bg-secondary-container px-3 py-2 text-label-md text-on-secondary-container"
        >
          <span>
            🍽️ Mesa {pedido.mesaNumero}: pedido listo para entregar
          </span>
          {puedeOperarTransiciones && (
            <button
              onClick={() => emitirTransicion(pedido.id, 'ENTREGADO')}
              className="rounded-md bg-secondary px-2 py-1 text-on-secondary"
            >
              Confirmar entrega
            </button>
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
      {bannerListos}
      {!conectado && !loading && (
        <div role="status" className="shrink-0 rounded-lg bg-tertiary-container px-3 py-1.5 text-label-md text-on-tertiary-container">
          Reconectando…
        </div>
      )}
      {contenido}
    </div>
  );
}
