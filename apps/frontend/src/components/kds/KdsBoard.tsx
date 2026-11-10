'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { useAlertas } from '@/components/alertas/AlertasProvider';
import { OrderTicket } from './OrderTicket';
import { CancelarPedidoDialog } from './CancelarPedidoDialog';
import { nombreDelMedio, type PedidoCancelado } from './cancelacion.utils';
import {
  separarPorCola,
  textoAltaDemanda,
  textoContadorCola,
  type EstadoCola,
} from './cola-kds.utils';
import { INTERVALO_RELOJ_MS } from './espera-kds.utils';
import { useReloj } from './useReloj';
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
  // HU-042 (BL-466): estado de la cola. null = desactivada (o el servidor
  // todavía no lo mandó): el tablero se ve como siempre.
  const [cola, setCola] = useState<EstadoCola | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // HU-024 (BL-104): pedido que se está cancelando y aviso del resultado.
  const [aCancelar, setACancelar] = useState<Pedido | null>(null);
  const [avisoCancelacion, setAvisoCancelacion] = useState<string | null>(null);
  // HU-038 (BL-208): reloj del tablero. Cada 30 s se vuelven a dibujar las
  // comandas con el tiempo de espera y el color al día, aunque no llegue
  // ningún evento por el socket.
  const ahora = useReloj(INTERVALO_RELOJ_MS);

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
        // HU-024 (BL-104): un pedido cancelado también sale del tablero.
        if (payload.estado === 'ENTREGADO' || payload.estado === 'CANCELADO') {
          return prev.filter((p) => p.id !== payload.id);
        }
        return prev.map((p) =>
          p.id === payload.id ? { ...p, estado: payload.estado } : p,
        );
      });
    };

    // HU-042 (BL-466): llega al conectar (si la cola está activa) y cada vez
    // que entra o sale un pedido de la cola. Con activa=false se apagó desde
    // Configuración.
    const alColaActualizada = (estado: EstadoCola) => {
      setCola(estado.activa ? estado : null);
    };

    const alError = (err: { message: string }) => {
      setLoadError(err.message);
      setLoading(false);
    };

    socket.on('pedidos:snapshot', alSnapshotPedidos);
    socket.on('pedido:nuevo', alPedidoNuevo);
    socket.on('pedido:actualizado', alPedidoActualizado);
    socket.on('cola:actualizada', alColaActualizada);
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
      socket.off('cola:actualizada', alColaActualizada);
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

  function cancelado(resultado: PedidoCancelado) {
    const mesa = aCancelar?.mesaNumero;
    setACancelar(null);
    setPedidos((prev) => prev.filter((p) => p.id !== resultado.pedidoId));
    const medios = [
      ...new Set(resultado.devoluciones.map((d) => nombreDelMedio(d.medio))),
    ].join(' y ');
    const como = medios ? 'con ' + medios : 'el pago';
    setAvisoCancelacion(
      `Pedido de la mesa ${mesa ?? ''} cancelado. Se devolvió ${como} y se emite la nota de crédito.`,
    );
  }

  const abrirCancelacion = puedeOperarTransiciones
    ? (pedido: Pedido) => {
        setAvisoCancelacion(null);
        setACancelar(pedido);
      }
    : undefined;

  // HU-042 (BL-466): con la cola activa, los pedidos en espera van a su
  // propia sección; el tablero agrupado por mesa muestra el resto.
  const { enEspera, activos } = separarPorCola(pedidos, cola);
  const colaActiva = cola !== null;

  const gruposPorMesa = (() => {
    const mapa = new Map<number, Pedido[]>();
    for (const pedido of activos) {
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
    const tablero = (
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
                  ahora={ahora}
                  colaActiva={colaActiva}
                  onCancelar={abrirCancelacion}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );

    contenido = colaActiva ? (
      <div className="flex min-h-0 flex-1 gap-gutter">
        {/* HU-042 (BL-466): cola de espera, en orden de llegada. */}
        <section
          aria-labelledby="titulo-en-espera"
          className="flex h-full shrink-0 flex-col gap-1.5"
        >
          <h2
            id="titulo-en-espera"
            className="shrink-0 rounded-md bg-surface-container-low px-2 py-1 text-label-sm font-semibold text-on-surface-variant"
          >
            En espera · {enEspera.length}
          </h2>
          {enEspera.length === 0 ? (
            <p className="w-[300px] px-2 text-body-sm text-on-surface-variant">
              No hay pedidos esperando.
            </p>
          ) : (
            <ol className="flex h-full gap-gutter overflow-x-auto overflow-y-hidden pb-4">
              {enEspera.map(({ pedido, posicion }) => (
                <li key={pedido.id} className="h-full">
                  <OrderTicket
                    pedido={pedido}
                    puedeOperarTransiciones={puedeOperarTransiciones}
                    onTransicion={emitirTransicion}
                    ahora={ahora}
                    colaActiva
                    posicionEnCola={posicion}
                    onCancelar={abrirCancelacion}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
        <section
          aria-labelledby="titulo-en-preparacion"
          className="flex min-w-0 flex-1 flex-col gap-1.5"
        >
          <h2
            id="titulo-en-preparacion"
            className="shrink-0 rounded-md bg-surface-container-low px-2 py-1 text-label-sm font-semibold text-on-surface-variant"
          >
            En cocina
          </h2>
          {tablero}
        </section>
      </div>
    ) : (
      tablero
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {avisoCancelacion && (
        // <output>: rol «status» implícito, el lector de pantalla lo anuncia.
        <output className="block shrink-0 rounded-lg bg-surface-container px-3 py-2 text-body-md text-on-surface">
          {avisoCancelacion}
        </output>
      )}
      <CancelarPedidoDialog
        pedido={aCancelar}
        token={token}
        onClose={() => setACancelar(null)}
        onCancelado={cancelado}
      />
      {!conectado && !loading && (
        <div role="status" className="shrink-0 rounded-lg bg-tertiary-container px-3 py-1.5 text-label-md text-on-tertiary-container">
          Reconectando…
        </div>
      )}
      {/* HU-042 (BL-466): ocupación de la cocina y alerta de alta demanda.
          aria-live para que el lector de pantalla lo anuncie sin mover el
          foco. */}
      {cola && !loading && (
        <div aria-live="polite" className="flex shrink-0 flex-col gap-1">
          <p
            data-testid="cola-contador"
            className="text-label-md font-semibold text-on-surface-variant"
          >
            {textoContadorCola(cola)}
          </p>
          {cola.altaDemanda && (
            <p
              data-testid="cola-alta-demanda"
              className="flex items-center gap-2 rounded-lg bg-error-container px-3 py-1.5 text-label-md font-semibold text-on-error-container"
            >
              <span aria-hidden="true">⚠</span>
              {textoAltaDemanda(cola)}
            </p>
          )}
        </div>
      )}
      {contenido}
    </div>
  );
}
