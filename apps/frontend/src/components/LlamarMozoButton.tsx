'use client';

import { useState } from 'react';
import {
  headersMesaQr,
  mensajeErrorQr,
  RUTA_LLAMAR_MOZO,
  solicitudAuthComensal,
  type OrigenMenu,
} from '@/components/menu-digital.utils';

interface LlamarMozoButtonProps {
  /**
   * HU-034 (BL-204): token opaco del QR. La mesa sale de acá, del lado del
   * servidor (POST /mesas/llamar con X-Mesa-Token); el botón no conoce ids.
   */
  readonly qrToken: string;
}

const MENSAJE_ERROR_GENERICO = 'No pudimos avisarle al mozo. Probá de nuevo.';

type Estado = 'idle' | 'enviando' | 'enviado' | 'error';

export function LlamarMozoButton({ qrToken }: LlamarMozoButtonProps) {
  const origen: OrigenMenu = { tipo: 'mesa', qrToken };
  const [estado, setEstado] = useState<Estado>('idle');
  const [mensaje, setMensaje] = useState<string | null>(null);

  const triggerFeedback = (tipo: 'click' | 'success' | 'error') => {
    if (typeof window === 'undefined') return;
    try {
      if (tipo === 'click') {
        if (navigator.vibrate) navigator.vibrate(50);
      } else if (tipo === 'success') {
        if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
      } else if (tipo === 'error') {
        if (navigator.vibrate) navigator.vibrate([200]);
      }
    } catch {
      // Ignorar si no hay soporte
    }
  };

  function mostrarError(texto: string | null) {
    setEstado('error');
    setMensaje(texto ?? MENSAJE_ERROR_GENERICO);
    triggerFeedback('error');
    setTimeout(() => setEstado('idle'), 5000);
  }

  async function llamar() {
    triggerFeedback('click');
    setEstado('enviando');
    setMensaje(null);

    try {
      const auth = solicitudAuthComensal(origen);
      const authRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}${auth.ruta}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(auth.body),
        },
      );
      if (!authRes.ok) {
        mostrarError(mensajeErrorQr(origen, authRes.status));
        return;
      }
      const { accessToken } = await authRes.json();

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}${RUTA_LLAMAR_MOZO}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...headersMesaQr(origen),
          },
        },
      );

      if (res.status === 429) {
        setEstado('error');
        setMensaje('Ya llamaste al mozo. Esperá un minuto.');
        triggerFeedback('error');
        setTimeout(() => setEstado('idle'), 5000);
        return;
      }
      if (!res.ok) {
        mostrarError(mensajeErrorQr(origen, res.status));
        return;
      }

      setEstado('enviado');
      setMensaje('¡Listo! Avisamos al mozo.');
      triggerFeedback('success');
      
      setTimeout(() => {
        setEstado('idle');
        setMensaje(null);
      }, 60_000);
    } catch {
      mostrarError(null);
    }
  }

  // Se extrajo la lógica para evitar los operadores ternarios anidados
  const getEstadoClasses = (currentState: Estado) => {
    switch (currentState) {
      case 'idle':
        return 'bg-white border border-[#6e54ad]/30 text-[#6e54ad] hover:border-[#6e54ad] hover:bg-[#6e54ad]/5 active:scale-[0.95]';
      case 'enviando':
        return 'bg-[#6e54ad]/10 border border-transparent text-[#6e54ad] cursor-not-allowed';
      case 'enviado':
        return 'bg-[#1e8e3e]/10 border border-[#1e8e3e]/30 text-[#1e8e3e] cursor-not-allowed scale-105';
      case 'error':
        return 'bg-red-800/10 border border-red-800/30 text-red-800 active:scale-[0.95] animate-shake';
      default:
        return '';
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={llamar}
        disabled={estado === 'enviando' || estado === 'enviado'}
        className={`group relative overflow-hidden flex items-center justify-center gap-2.5 px-8 py-3 rounded-full font-semibold text-sm md:text-base transition-all duration-300 ease-out shadow-sm ${getEstadoClasses(estado)}`}
        aria-label="Llamar al mozo"
      >
        {estado === 'idle' && (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:rotate-12 group-active:-rotate-12">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            Llamar al mozo
          </>
        )}

        {estado === 'enviando' && (
          <>
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Avisando...
          </>
        )}

        {estado === 'enviado' && (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-bounce">
              <path d="M20 6L9 17l-5-5"></path>
            </svg>
            ¡Mozo en camino!
          </>
        )}

        {estado === 'error' && (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            Reintentar
          </>
        )}
      </button>

      <div className="h-5 mt-1">
        {mensaje && (
          <output className={`block text-xs font-medium text-center transition-opacity ${estado === 'error' ? 'text-red-800' : 'text-[#1e8e3e]'}`}>
            {mensaje}
          </output>
        )}
      </div>
    </div>
  );
}
