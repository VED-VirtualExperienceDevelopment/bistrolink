'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import {
  llamadosDelSnapshot,
  quitarLlamadoDePedido,
  type LlamadoMozo,
} from '@/components/kds/llamado.utils';
import {
  agregarLlamadoConservandoEspera,
  ordenarLlamados,
} from './alertas.utils';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type AccionLlamado = 'aceptado' | 'desestimado';

export interface AlertasContexto {
  /** Alertas pendientes, la más antigua primero. */
  llamados: LlamadoMozo[];
  cantidad: number;
  conectado: boolean;
  /**
   * Socket del staff, para quien necesite más eventos que las alertas
   * (KdsBoard, con los pedidos). Lo abre y lo cierra este proveedor: quien lo
   * use solo agrega y quita sus propios listeners. Null mientras no hay sesión.
   */
  socket: Socket | null;
  /** Solo MOZO y ADMIN pueden aceptar o desestimar (el servidor también lo exige). */
  puedeResolver: boolean;
  /**
   * Sube cada vez que llega un llamado nuevo en vivo (no con el snapshot al
   * conectar). La campana lo usa para disparar la animación.
   */
  llegadas: number;
  resolver: (mesaId: string, accion: AccionLlamado) => void;
  /** Vista rápida de la campana: abierta o cerrada (la pantalla Alertas es una página aparte). */
  panelAbierto: boolean;
  abrirPanel: () => void;
  cerrarPanel: () => void;
  alternarPanel: () => void;
}

const AlertasContext = createContext<AlertasContexto | null>(null);

/**
 * BL-441: único socket del staff dentro de /admin/*. Mantiene las alertas
 * (llamados de mesa y avisos de pago en efectivo) para la campana, el menú y
 * la pantalla Alertas. Los eventos son los mismos que ya usa KdsBoard.
 *
 * Una alerta por mesa: si la mesa vuelve a llamar, queda el último llamado
 * pero con la hora del primero, para que no pierda su lugar en la lista.
 *
 * Las alertas pendientes viven también en el servidor: al conectar, y cada
 * vez que se vuelve a abrir el socket (por ejemplo, con un token renovado),
 * el snapshot reemplaza la lista completa.
 */
export function AlertasProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { token, hasRole } = useKeycloakAuth();
  const [llamados, setLlamados] = useState<LlamadoMozo[]>([]);
  const [conectado, setConectado] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [llegadas, setLlegadas] = useState(0);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const puedeResolver = Boolean(hasRole('MOZO') || hasRole('ADMIN'));

  useEffect(() => {
    if (!token) return;

    const nuevo = io(WS_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = nuevo;
    setSocket(nuevo);

    nuevo.on('connect', () => setConectado(true));
    nuevo.on('disconnect', () => setConectado(false));

    nuevo.on('llamado:nuevo', (llamado: LlamadoMozo) => {
      setLlamados((prev) => agregarLlamadoConservandoEspera(prev, llamado));
      setLlegadas((n) => n + 1);
    });

    // Al conectar o reconectar el servidor manda todas las alertas pendientes:
    // reemplazan a las que había (pudieron resolverse sin conexión).
    nuevo.on('llamados:snapshot', (snapshot: LlamadoMozo[]) => {
      setLlamados(llamadosDelSnapshot(snapshot));
    });

    nuevo.on('llamado:resuelto', ({ mesaId }: { mesaId: string }) => {
      setLlamados((prev) => prev.filter((l) => l.mesaId !== mesaId));
    });

    // Un aviso de efectivo se resuelve solo cuando el pedido se cobra.
    nuevo.on('pedido:nuevo', (pedido: { id: string }) => {
      setLlamados((prev) => quitarLlamadoDePedido(prev, pedido.id));
    });

    return () => {
      nuevo.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [token]);

  const resolver = useCallback((mesaId: string, accion: AccionLlamado) => {
    socketRef.current?.emit('llamado:resolver', { mesaId, accion });
  }, []);

  const abrirPanel = useCallback(() => setPanelAbierto(true), []);
  const cerrarPanel = useCallback(() => setPanelAbierto(false), []);
  const alternarPanel = useCallback(
    () => setPanelAbierto((abierto) => !abierto),
    [],
  );

  const valor = useMemo<AlertasContexto>(() => {
    const ordenados = ordenarLlamados(llamados);
    return {
      llamados: ordenados,
      cantidad: ordenados.length,
      conectado,
      socket,
      puedeResolver,
      llegadas,
      resolver,
      panelAbierto,
      abrirPanel,
      cerrarPanel,
      alternarPanel,
    };
  }, [
    llamados,
    conectado,
    socket,
    puedeResolver,
    llegadas,
    resolver,
    panelAbierto,
    abrirPanel,
    cerrarPanel,
    alternarPanel,
  ]);

  return (
    <AlertasContext.Provider value={valor}>{children}</AlertasContext.Provider>
  );
}

/**
 * Devuelve null fuera de /admin/* (por ejemplo, en el /kds de COCINA). Quien
 * lo use tiene que contemplar ese caso.
 */
export function useAlertas(): AlertasContexto | null {
  return useContext(AlertasContext);
}
