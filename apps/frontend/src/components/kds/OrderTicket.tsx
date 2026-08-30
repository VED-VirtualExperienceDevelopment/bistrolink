import type { Pedido } from '@/types/pedido';

interface OrderTicketProps {
  pedido: Pedido;
}

// Umbral simple para el color de urgencia según minutos desde la recepción.
// Ajustar estos valores junto con el equipo si el tiempo de preparación
// promedio del establecimiento difiere.
function getUrgencyColor(createdAt: string): { bg: string; label: string } {
  const minutos = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (minutos >= 15) return { bg: 'bg-error', label: 'Demorado' };
  if (minutos >= 8) return { bg: 'bg-tertiary-container', label: 'Atención' };
  return { bg: 'bg-primary', label: 'A tiempo' };
}

function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
}

export function OrderTicket({ pedido }: OrderTicketProps) {
  const urgencia = getUrgencyColor(pedido.createdAt);

  return (
    <article className="flex h-full w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      {/* Header del ticket */}
      <div className={`${urgencia.bg} flex shrink-0 items-start justify-between p-3 text-on-primary`}>
        <div>
          <div className="text-headline-sm font-bold">Mesa {pedido.mesaNumero}</div>
          <div className="text-body-sm opacity-90">{urgencia.label}</div>
        </div>
        <div className="text-right">
          <div className="text-headline-md font-bold">{formatHora(pedido.createdAt)}</div>
          <div className="mt-1 rounded bg-white/20 px-2 py-0.5 text-label-md text-white">
            {pedido.estado}
          </div>
        </div>
      </div>

      {/* Observación general del pedido (HU-021) */}
      {pedido.observacionGeneral && (
        <div className="shrink-0 border-b border-outline-variant bg-error-container px-3 py-2 text-body-sm text-on-error-container">
          ⚠ {pedido.observacionGeneral}
        </div>
      )}

      {/* Ítems */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {pedido.lineas.map((linea) => (
          <div key={linea.id} className="border-b border-surface-variant pb-3 last:border-0">
            <div className="flex items-center gap-2 text-body-lg font-semibold">
              <span className="font-bold text-primary">{linea.cantidad}x</span>
              {linea.nombreSnapshot}
            </div>
            {linea.observacion && (
              <div className="mt-1 border-l-2 border-error pl-2 text-body-sm font-semibold text-error">
                {linea.observacion}
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}