'use client';

import { useState } from 'react';

interface LlamarMozoButtonProps {
  readonly tenantId: string;
  readonly mesaId: string;
}

type Estado = 'idle' | 'enviando' | 'enviado' | 'error';

export function LlamarMozoButton({ tenantId, mesaId }: LlamarMozoButtonProps) {
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

  async function llamar() {
    triggerFeedback('click');
    setEstado('enviando');
    setMensaje(null);

    try {
      const authRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/comensal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, mesaId }),
        },
      );
      if (!authRes.ok) throw new Error();
      const { accessToken } = await authRes.json();

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/mesas/${mesaId}/llamar`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (res.status === 429) {
        setEstado('error');
        setMensaje('Ya llamaste al mozo. Esperá un minuto.');
        triggerFeedback('error');
        setTimeout(() => setEstado('idle'), 5000);
        return;
      }
      if (!res.ok) throw new Error();

      setEstado('enviado');
      setMensaje('¡Listo! Avisamos al mozo.');
      triggerFeedback('success');
      
      setTimeout(() => {
        setEstado('idle');
        setMensaje(null);
      }, 60_000);
    } catch {
      setEstado('error');
      setMensaje('No pudimos avisarle al mozo. Probá de nuevo.');
      triggerFeedback('error');
      setTimeout(() => setEstado('idle'), 5000);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={llamar}
        disabled={estado === 'enviando' || estado === 'enviado'}
        className={`
          group relative overflow-hidden flex items-center justify-center gap-2.5 px-8 py-3 rounded-full font-semibold text-sm md:text-base transition-all duration-300 ease-out shadow-sm
          ${
            estado === 'idle'
              ? 'bg-white border border-brand-800/30 text-brand-800 hover:border-brand-800 hover:bg-brand-800/5 active:scale-[0.95]'
              : estado === 'enviando'
              ? 'bg-brand-800/10 border border-transparent text-brand-800 cursor-not-allowed'
              : estado === 'enviado'
              ? 'bg-[#1e8e3e]/10 border border-[#1e8e3e]/30 text-[#1e8e3e] cursor-not-allowed scale-105'
              : 'bg-red-800/10 border border-red-800/30 text-red-800 active:scale-[0.95] animate-shake'
          }
        `}
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
          <p role="status" className={`text-xs font-medium text-center transition-opacity ${estado === 'error' ? 'text-red-800' : 'text-[#1e8e3e]'}`}>
            {mensaje}
          </p>
        )}
      </div>
    </div>
  );
}
