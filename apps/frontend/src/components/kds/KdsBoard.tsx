'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { useAlertas } from '@/components/alertas/AlertasProvider';
import { IndicadorConexion } from '@/components/conexion/IndicadorConexion';
import { useEstadoConexion } from '@/components/conexion/useEstadoConexion';
import { OrderTicket } from './OrderTicket';
import { CancelarPedidoDialog } from './CancelarPedidoDialog';
import { nombreDelMedio, type PedidoCancelado } from './cancelacion.utils';
import {
  separarPorCola,
  textoAltaDemanda,
  textoContadorCola,
  type EstadoCola,
} from './cola-kds.utils';
import {
  INTERVALO_RELOJ_MS,
  UMBRALES_ESPERA_POR_DEFECTO,
  sonUmbralesValidos,
  type UmbralesEspera,
} from './espera-kds.utils';
import { useReloj } from './useReloj';
import { MonitorCocina } from './MonitorCocina';
import type { Pedido } from '@/types/pedido';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type EstadoPedido = Pedido['estado'];

interface PedidoActualizadoPayload {
  id: string;
  estado: EstadoPedido;
  actualizadoEn: string;
  mesaNumero?: number;
}

/** Props que comparten todas las comandas del tablero. */
interface PropsComanda {
  puedeOperarTransiciones: boolean;
  onTransicion: (pedidoId: string, nuevoEstado: EstadoPedido) => void;
  ahora: number;
  umbrales: UmbralesEspera;
  onCancelar?: (pedido: Pedido) => void;
}

interface GrupoMesa {
  mesaNumero: number;
  pedidos: Pedido[];
}

const msDe = (pedido: Pedido) => new Date(pedido.createdAt).getTime();

/**
 * Agrupa los pedidos por mesa: dentro de cada mesa, por hora de llegada; las
 * mesas, por su pedido más viejo.
 */
function agruparPorMesa(activos: Pedido[]): GrupoMesa[] {
  const mapa = new Map<number, Pedido[]>();
  for (const pedido of activos) {
    const grupo = mapa.get(pedido.mesaNumero) ?? [];
    grupo.push(pedido);
    mapa.set(pedido.mesaNumero, grupo);
  }
  return [...mapa.entries()]
    .map(([mesaNumero, pedidosDeLaMesa]) => ({
      mesaNumero,
      pedidos: [...pedidosDeLaMesa].sort((a, b) => msDe(a) - msDe(b)),
    }))
    .sort((a, b) => msDe(a.pedidos[0]) - msDe(b.pedidos[0]));
}

const CLASE_TITULO_SECCION =
  'shrink-0 rounded-md bg-surface-container-low px-2 py-1 text-label-sm font-semibold text-on-surface-variant';

/** Tablero de comandas agrupadas por mesa. */
function TableroPorMesa({
  grupos,
  colaActiva,
  comanda,
}: Readonly<{ grupos: GrupoMesa[]; colaActiva: boolean; comanda: PropsComanda }>) {
  return (
    <div className="flex h-full gap-gutter overflow-x-auto overflow-y-hidden pb-4">
      {grupos.map(({ mesaNumero, pedidos }) => (
        <div key={mesaNumero} className="flex h-full shrink-0 flex-col gap-1.5">
          {pedidos.length > 1 && (
            <div className={CLASE_TITULO_SECCION}>
              Mesa {mesaNumero} · {pedidos.length} pedidos
            </div>
          )}
          <div className="flex h-full gap-gutter">
            {pedidos.map((pedido) => (
              <OrderTicket
                key={pedido.id}
                pedido={pedido}
                colaActiva={colaActiva}
                {...comanda}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * HU-042 (BL-466): cola de espera, en orden de llegada.
 *
 * BL-507 (#472): como mucho la mitad del ancho. Antes tenía `shrink-0` y
 * crecía con todos los tickets: el `overflow-x-auto` de la lista nunca se
 * activaba y en /admin/kds scrolleaba la página entera.
 */
function SeccionEnEspera({
  enEspera,
  comanda,
}: Readonly<{
  enEspera: ReturnType<typeof separarPorCola>['enEspera'];
  comanda: PropsComanda;
}>) {
  return (
    <section
      aria-labelledby="titulo-en-espera"
      className="flex h-full min-w-0 max-w-[50%] flex-col gap-1.5"
    >
      <h2 id="titulo-en-espera" className={CLASE_TITULO_SECCION}>
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
                colaActiva
                posicionEnCola={posicion}
                {...comanda}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Tablero de Mozo y Admin: con la cola activa (HU-042), «En espera» y «En
 * cocina»; si no, solo el tablero por mesa.
 */
function TableroStaff({
  colaActiva,
  enEspera,
  grupos,
  comanda,
}: Readonly<{
  colaActiva: boolean;
  enEspera: ReturnType<typeof separarPorCola>['enEspera'];
  grupos: GrupoMesa[];
  comanda: PropsComanda;
}>) {
  const tablero = (
    <TableroPorMesa grupos={grupos} colaActiva={colaActiva} comanda={comanda} />
  );
  if (!colaActiva) return tablero;
  return (
    <div className="flex min-h-0 flex-1 gap-gutter">
      <SeccionEnEspera enEspera={enEspera} comanda={comanda} />
      <section
        aria-labelledby="titulo-en-preparacion"
        className="flex min-w-0 flex-1 flex-col gap-1.5"
      >
        <h2 id="titulo-en-preparacion" className={CLASE_TITULO_SECCION}>
          En cocina
        </h2>
        {tablero}
      </section>
    </div>
  );
}

/**
 * Lo que se ve mientras no hay comandas para mostrar (cargando, sin
 * conexión, error o sin pedidos); si hay, el tablero (`children`).
 */
function ContenidoKds({
  loading,
  sinConexion,
  loadError,
  hayPedidos,
  children,
}: Readonly<{
  loading: boolean;
  sinConexion: boolean;
  loadError: string | null;
  hayPedidos: boolean;
  children: ReactNode;
}>) {
  if (loading && sinConexion) {
    // HU-038 (BL-504): antes, si la primera conexión fallaba, el tablero
    // quedaba con la ruedita para siempre.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-body-lg text-on-surface-variant">
        <span>No se pudo conectar con el servidor.</span>
        <span className="text-body-md">
          Se sigue intentando: los pedidos aparecen solos cuando vuelva la
          conexión.
        </span>
      </div>
    );
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
  if (!hayPedidos) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-body-md text-on-surface-variant">
        <span>No hay pedidos activos en este momento.</span>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * HU-042 (BL-466): ocupación de la cocina y alerta de alta demanda.
 * aria-live para que el lector de pantalla lo anuncie sin mover el foco.
 */
function AvisoCola({ cola }: Readonly<{ cola: EstadoCola }>) {
  return (
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
  );
}

export function KdsBoard() {
  const { token, hasRole } = useKeycloakAuth();
  // BL-441: dentro de /admin/* el socket y las alertas vienen de
  // AlertasProvider (un solo socket del staff). El /kds de COCINA no tiene
  // ese proveedor y sigue abriendo el suyo.
  const alertas = useAlertas();
  const enShell = alertas !== null;
  const socketCompartido = alertas?.socket ?? null;
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // HU-038 (BL-504): socket propio del /kds de Cocina, para el indicador de
  // conexión. Dentro de /admin/* se usa el compartido.
  const [socketPropio, setSocketPropio] = useState<Socket | null>(null);
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
  // HU-038 (BL-506): umbrales de espera del local. Llegan al conectar y cada
  // vez que el administrador los cambia en Configuración.
  const [umbrales, setUmbrales] = useState<UmbralesEspera>(
    UMBRALES_ESPERA_POR_DEFECTO,
  );

  // HU-038 (BL-504): conectando / conectado / reconectando / desconectado.
  const estadoConexion = useEstadoConexion(
    enShell ? socketCompartido : socketPropio,
  );
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
      setSocketPropio(socket);
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

    // HU-038 (BL-506): si llegan mal formados, se ignoran y el tablero sigue
    // con los que tenía.
    const alUmbralesEspera = (valor: unknown) => {
      if (sonUmbralesValidos(valor)) setUmbrales(valor);
    };

    const alError = (err: { message: string }) => {
      setLoadError(err.message);
      setLoading(false);
    };

    socket.on('pedidos:snapshot', alSnapshotPedidos);
    socket.on('pedido:nuevo', alPedidoNuevo);
    socket.on('pedido:actualizado', alPedidoActualizado);
    socket.on('cola:actualizada', alColaActualizada);
    socket.on('kds:umbrales-espera', alUmbralesEspera);
    socket.on('error', alError);

    // El estado de la conexión lo sigue useEstadoConexion (HU-038, BL-504).
    // Con el socket compartido ya conectado, se piden los pedidos de nuevo.
    if (!propio && socket.connected) {
      socket.emit('pedidos:sync');
    }

    return () => {
      socket.off('pedidos:snapshot', alSnapshotPedidos);
      socket.off('pedido:nuevo', alPedidoNuevo);
      socket.off('pedido:actualizado', alPedidoActualizado);
      socket.off('cola:actualizada', alColaActualizada);
      socket.off('kds:umbrales-espera', alUmbralesEspera);
      socket.off('error', alError);
      if (propio) {
        // El socket compartido lo cierra AlertasProvider, no este tablero.
        socket.disconnect();
        setSocketPropio(null);
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

  // SonarQube (complejidad cognitiva): el tablero, la cola y los estados de
  // carga están en componentes aparte, arriba en este archivo.
  const comanda: PropsComanda = {
    puedeOperarTransiciones,
    onTransicion: emitirTransicion,
    ahora,
    umbrales,
    onCancelar: abrirCancelacion,
  };

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
      {/* HU-038 (BL-504): siempre visible, para saber de un vistazo si la
          pantalla está al día. */}
      <div className="flex shrink-0 justify-end">
        <IndicadorConexion estado={estadoConexion} />
      </div>
      {/* HU-038 (BL-510): en el monitor de Cocina, la cola va en su barra de
          resumen. */}
      {puedeOperarTransiciones && cola && !loading && <AvisoCola cola={cola} />}
      <ContenidoKds
        loading={loading}
        sinConexion={estadoConexion === 'desconectado'}
        loadError={loadError}
        hayPedidos={pedidos.length > 0}
      >
        {/* HU-038 (BL-510): Cocina ve el monitor (solo lectura, sin scroll);
            Mozo y Admin, el tablero con sus botones. */}
        {puedeOperarTransiciones ? (
          <TableroStaff
            colaActiva={colaActiva}
            enEspera={enEspera}
            grupos={agruparPorMesa(activos)}
            comanda={comanda}
          />
        ) : (
          <MonitorCocina
            pedidos={pedidos}
            cola={cola}
            ahora={ahora}
            umbrales={umbrales}
          />
        )}
      </ContenidoKds>
    </div>
  );
}
