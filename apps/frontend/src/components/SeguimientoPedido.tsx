'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Inter, Public_Sans } from 'next/font/google';
import { ESTADO_LABEL } from './kds/OrderTicket';
import type { EstadoPedido } from '@/types/pedido';

const inter = Inter({ subsets: ['latin'], weight: ['600', '700'] });
const publicSans = Public_Sans({ subsets: ['latin'], weight: ['500', '600'] });

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
}

export function SeguimientoPedido({
  pedidoId,
  token,
  estadoInicial,
}: SeguimientoPedidoProps) {
  const [estado, setEstado] = useState<EstadoPedido>(estadoInicial);
  const [actualizadoEn, setActualizadoEn] = useState<string | null>(null);
  const [conectado, setConectado] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(WS_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConectado(true);
      socket.emit('pedido:seguir', { pedidoId });
    });

    socket.on('disconnect', () => setConectado(false));

    socket.on('pedido:actualizado', (payload: PedidoActualizadoPayload) => {
      if (payload.id !== pedidoId) return;
      setEstado(payload.estado);
      setActualizadoEn(payload.actualizadoEn);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [pedidoId, token]);

  const indiceActual = PROGRESION.indexOf(estado);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <span className={`${publicSans.className} text-xs text-culinary-neutral`}>
          {conectado ? '🟢 En vivo' : '⏳ Reconectando...'}
        </span>
        {actualizadoEn && (
          <span className={`${publicSans.className} text-xs text-culinary-neutral`}>
            Actualizado {new Date(actualizadoEn).toLocaleTimeString('es-UY')}
          </span>
        )}
      </div>

      <ol className="flex items-start justify-between">
        {PROGRESION.map((paso, i) => {
          const alcanzado = i <= indiceActual;
          const esActual = i === indiceActual;

          return (
            <li key={paso} className="flex flex-1 flex-col items-center text-center">
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
                className={`${publicSans.className} mt-1 text-xs ${
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

      <p className={`${inter.className} text-center text-sm font-semibold text-culinary-primary mt-4`}>
        {ESTADO_LABEL[estado]}
      </p>
    </div>
  );
}
