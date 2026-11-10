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
import ReponerStockDialog from '@/components/admin/stock/ReponerStockDialog';
import { useAlertasStock } from '@/components/admin/stock/useAlertasStock';
import type { AlertaStock } from '@/components/admin/stock/stock.utils';
import {
  agregarLlamadoConservandoEspera,
  anuncioLlamado,
  ordenarLlamados,
} from './alertas.utils';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Lista vacía fija: una nueva en cada render rompería el useMemo del valor.
const SIN_ALERTAS_STOCK: AlertaStock[] = [];

/** BL-470: id del botón de la campana, para devolverle el foco. */
export const ID_BOTON_CAMPANA = 'boton-campana-alertas';

export type AccionLlamado = 'aceptado' | 'desestimado';

export interface AlertasContexto {
  /** Alertas del salón pendientes, la más antigua primero. */
  llamados: LlamadoMozo[];
  /** BL-470: alertas de stock. Vacío si el rol no las ve. */
  alertasStock: AlertaStock[];
  /** Unidades vendidas sin stock por ítem, avisadas en vivo. */
  sinStock: Record<string, number>;
  /** BL-470: no se pudieron cargar las alertas de stock. */
  errorStock: string | null;
  /** BL-470: solo el Administrador ve la sección Stock. */
  veStock: boolean;
  /** Total de lo que ve este rol: salón y, para el Administrador, stock. */
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
   * Sube cada vez que llega una alerta nueva en vivo, del salón o de stock
   * (no con el snapshot ni con la carga al conectar). La campana lo usa para
   * disparar la animación.
   */
  llegadas: number;
  /**
   * BL-470: texto para la región aria-live de la campana, que existe
   * siempre (con la vista rápida abierta o cerrada).
   */
  anuncio: string;
  resolver: (mesaId: string, accion: AccionLlamado) => void;
  /** BL-470: abre «Reponer stock» para un ítem y cierra la vista rápida. */
  abrirReponer: (alerta: AlertaStock) => void;
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
 *
 * BL-470: suma las alertas de stock del Administrador (useAlertasStock, con
 * su propia conexión a la sala de administradores), así la campana, el menú
 * y la pantalla Alertas muestran el mismo total. También monta el diálogo
 * «Reponer stock», fuera de la vista rápida, para que siga abierto cuando
 * ella se cierra.
 */
export function AlertasProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { token, hasRole } = useKeycloakAuth();
  const [llamados, setLlamados] = useState<LlamadoMozo[]>([]);
  const [conectado, setConectado] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [llegadasSalon, setLlegadasSalon] = useState(0);
  const [anuncioSalon, setAnuncioSalon] = useState('');
  const [anuncio, setAnuncio] = useState('');
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [reponiendo, setReponiendo] = useState<AlertaStock | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const puedeResolver = Boolean(hasRole('MOZO') || hasRole('ADMIN'));
  const veStock = Boolean(hasRole('ADMIN'));
  const stock = useAlertasStock(veStock);

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
      setLlegadasSalon((n) => n + 1);
      setAnuncioSalon(anuncioLlamado(llamado));
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

  // Una sola región aria-live: anuncia lo último que pasó, sea del salón o de
  // stock. Si llega dos veces el mismo texto seguido, se le alterna un
  // espacio duro al final para que el lector de pantalla lo vuelva a leer.
  useEffect(() => {
    if (anuncioSalon) setAnuncio((previo) => conCambio(previo, anuncioSalon));
  }, [anuncioSalon, llegadasSalon]);
  useEffect(() => {
    if (stock.anuncio) setAnuncio((previo) => conCambio(previo, stock.anuncio));
  }, [stock.anuncio, stock.llegadas]);

  const resolver = useCallback((mesaId: string, accion: AccionLlamado) => {
    socketRef.current?.emit('llamado:resolver', { mesaId, accion });
  }, []);

  const abrirPanel = useCallback(() => setPanelAbierto(true), []);
  const cerrarPanel = useCallback(() => setPanelAbierto(false), []);
  const alternarPanel = useCallback(
    () => setPanelAbierto((abierto) => !abierto),
    [],
  );
  const abrirReponer = useCallback((alerta: AlertaStock) => {
    setPanelAbierto(false);
    setReponiendo(alerta);
  }, []);
  // El diálogo devuelve el foco al botón que lo abrió si sigue en la página
  // (en la pantalla Alertas, al cancelar). Si no (la vista rápida se cerró o
  // la alerta ya salió de la lista), queda en la campana.
  const cerrarReponer = useCallback(() => {
    setReponiendo(null);
    document.getElementById(ID_BOTON_CAMPANA)?.focus();
  }, []);

  const alertasStock = veStock ? stock.alertas : SIN_ALERTAS_STOCK;

  const valor = useMemo<AlertasContexto>(() => {
    const ordenados = ordenarLlamados(llamados);
    return {
      llamados: ordenados,
      alertasStock,
      sinStock: stock.sinStock,
      errorStock: veStock ? stock.error : null,
      veStock,
      cantidad: ordenados.length + alertasStock.length,
      conectado,
      socket,
      puedeResolver,
      llegadas: llegadasSalon + stock.llegadas,
      anuncio,
      resolver,
      abrirReponer,
      panelAbierto,
      abrirPanel,
      cerrarPanel,
      alternarPanel,
    };
  }, [
    llamados,
    alertasStock,
    stock.sinStock,
    stock.error,
    stock.llegadas,
    veStock,
    conectado,
    socket,
    puedeResolver,
    llegadasSalon,
    anuncio,
    resolver,
    abrirReponer,
    panelAbierto,
    abrirPanel,
    cerrarPanel,
    alternarPanel,
  ]);

  return (
    <AlertasContext.Provider value={valor}>
      {children}
      {veStock && (
        <ReponerStockDialog
          alerta={reponiendo}
          onClose={cerrarReponer}
          onGuardar={stock.reponer}
        />
      )}
    </AlertasContext.Provider>
  );
}

/** Texto nuevo para la región aria-live; distinto del anterior aunque se repita. */
function conCambio(previo: string, texto: string): string {
  return previo === texto ? `${texto}\u00A0` : texto;
}

/**
 * Devuelve null fuera de /admin/* (por ejemplo, en el /kds de COCINA). Quien
 * lo use tiene que contemplar ese caso.
 */
export function useAlertas(): AlertasContexto | null {
  return useContext(AlertasContext);
}
