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

  async function llamar() {
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
        setMensaje('Ya llamaste al mozo. Esperá un minuto para volver a intentar.');
        return;
      }
      if (!res.ok) throw new Error();

      setEstado('enviado');
      setMensaje('¡Listo! Avisamos al mozo.');
      setTimeout(() => setEstado('idle'), 60_000);
    } catch {
      setEstado('error');
      setMensaje('No pudimos avisarle al mozo. Probá de nuevo.');
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-20 flex flex-col items-end gap-1">
      <button
        onClick={llamar}
        disabled={estado === 'enviando' || estado === 'enviado'}
        className="rounded-full bg-brand-700 px-5 py-3 text-white shadow-lg disabled:opacity-60"
      >
        {estado === 'enviado' ? '✓ Mozo avisado' : '🔔 Llamar al mozo'}
      </button>
      {mensaje && (
        <p role="status" className="max-w-[220px] text-right text-sm">
          {mensaje}
        </p>
      )}
    </div>
  );
}
