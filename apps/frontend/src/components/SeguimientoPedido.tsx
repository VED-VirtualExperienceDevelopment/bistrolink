'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ESTADO_LABEL } from './kds/OrderTicket';
import {
  lugarVigente,
  textoEnCola,
  type PosicionEnCola,
} from './kds/cola-kds.utils';
import type { EstadoPedido } from '@/types/pedido';
import { IndicadorConexion } from './conexion/IndicadorConexion';
import { useEstadoConexion } from './conexion/useEstadoConexion';


const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const PROGRESION: EstadoPedido[] = [
  'RECIBIDO',
  'EN_PREPARACION',
  'LISTO_PARA_ENTREGAR',
  'ENTREGADO',
];

interface PedidoActualizadoPayload {
  id: string;
  estado: EstadoPedido;
  actualizadoEn: string;
}

interface SeguimientoPedidoProps {
  readonly pedidoId: string;
  readonly token: string;
  readonly estadoInicial: EstadoPedido;
  /** BL-502: avisa cada cambio de estado (por ejemplo, para la pantalla de gracias). */
  readonly onCambioDeEstado?: (estado: EstadoPedido, actualizadoEn: string | null) => void;
}

export function SeguimientoPedido({
  pedidoId,
  token,
  estadoInicial,
  onCambioDeEstado,
}: SeguimientoPedidoProps) {
  const [estado, setEstado] = useState<EstadoPedido>(estadoInicial);
  const [actualizadoEn, setActualizadoEn] = useState<string | null>(null);
  // HU-038 (BL-504): el socket en estado, para el indicador de conexión.
  const [socketActual, setSocketActual] = useState<Socket | null>(null);
  const estadoConexion = useEstadoConexion(socketActual);
  // HU-042 (BL-466): lugar en la cola y tiempo estimado, mientras espera.
  const [lugar, setLugar] = useState<PosicionEnCola | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // BL-502: la última función recibida, sin reconectar el socket si cambia.
  const avisarCambio = useRef(onCambioDeEstado);
  avisarCambio.current = onCambioDeEstado;

  useEffect(() => {
    const socket = io(WS_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;
    setSocketActual(socket);

    // Al conectar y al reconectar: el servidor devuelve el estado actual y,
    // si espera, su lugar en la cola.
    socket.on('connect', () => {
      socket.emit('pedido:seguir', { pedidoId });
    });

    socket.on('pedido:actualizado', (payload: PedidoActualizadoPayload) => {
      if (payload.id !== pedidoId) return;
      setEstado(payload.estado);
      setActualizadoEn(payload.actualizadoEn);
      avisarCambio.current?.(payload.estado, payload.actualizadoEn ?? null);
    });

    // HU-042 (BL-466): el servidor manda solo el lugar de este pedido (sala
    // del pedido), al seguirlo y cada vez que la cola avanza.
    socket.on('pedido:cola', (payload: PosicionEnCola) => {
      if (payload.pedidoId !== pedidoId) return;
      setLugar(payload);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocketActual(null);
    };
  }, [pedidoId, token]);

  const indiceActual = PROGRESION.indexOf(estado);
  const lugarActual = lugarVigente(estado, lugar);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <IndicadorConexion estado={estadoConexion} textoConectado="En vivo" compacto />
        {actualizadoEn && (
          <span className="text-xs text-culinary-neutral">
            Actualizado {new Date(actualizadoEn).toLocaleTimeString('es-UY')}
          </span>
        )}
      </div>

      <ol className="flex items-start justify-between">
        {PROGRESION.map((paso, i) => {
          const alcanzado = i <= indiceActual;
          const esActual = i === indiceActual;

          return (
            <li key={paso}
             aria-current={esActual ? 'step' : undefined}
             className="flex flex-1 flex-col items-center text-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  alcanzado
                    ? 'bg-culinary-primary text-white'
                    : 'bg-culinary-primary-container text-culinary-neutral'
                }`}
              >
                {alcanzado ? '✓' : i + 1}
              </div>
              <span
                className={`mt-1 text-xs ${
                  esActual
                    ? 'font-semibold text-culinary-on-surface'
                    : 'text-culinary-neutral'
                }`}
              >
                {ESTADO_LABEL[paso]}
              </span>
              {i < PROGRESION.length - 1 && (
                <div
                  className={`hidden sm:block h-0.5 w-full mt-3 ${
                    i < indiceActual ? 'bg-culinary-primary' : 'bg-culinary-primary-container'
                  }`}
                  style={{ marginLeft: '50%', marginTop: '-1.15rem' }}
                />
              )}
            </li>
          );
        })}
      </ol>

    <p role="status" className="text-center text-sm font-semibold text-culinary-primary mt-4">
        {lugarActual ? textoEnCola(lugarActual) : ESTADO_LABEL[estado]}
      </p>
    </div>
  );
}
