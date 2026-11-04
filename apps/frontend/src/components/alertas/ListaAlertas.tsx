'use client';

import { useEffect, useState } from 'react';
import { useAlertas } from './AlertasProvider';
import {
  detalleEfectivo,
  esDemorada,
  tiempoTranscurrido,
  tituloAlerta,
} from './alertas.utils';

// Cada cuánto se actualiza el «hace X min» mientras la lista está a la vista.
const REFRESCO_TIEMPO_MS = 15_000;

/**
 * BL-441: lista de alertas pendientes (llamados de mesa y avisos de pago en
 * efectivo). La comparten la vista rápida de la campana y la pantalla Alertas.
 */
export function ListaAlertas() {
  const alertas = useAlertas();
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    const intervalo = setInterval(
      () => setAhora(Date.now()),
      REFRESCO_TIEMPO_MS,
    );
    return () => clearInterval(intervalo);
  }, []);

  if (!alertas) return null;
  const { llamados, puedeResolver, resolver } = alertas;

  if (llamados.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-body-md text-on-surface-variant">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[40px]"
        >
          done_all
        </span>
        <p>No hay alertas pendientes.</p>
      </div>
    );
  }

  return (
    <ul aria-live="polite" className="flex flex-col gap-2">
      {llamados.map((llamado) => {
        const efectivo = llamado.motivo === 'PAGO_EFECTIVO';
        const detalle = detalleEfectivo(llamado);
        const demorada = esDemorada(llamado.ts, ahora);
        return (
          <li
            key={llamado.mesaId}
            className={`flex flex-col gap-3 rounded-lg border bg-surface-container-low p-3 ${
              demorada ? 'border-error' : 'border-outline-variant'
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  efectivo
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'bg-tertiary-container text-on-tertiary-container'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {efectivo ? 'payments' : 'notifications_active'}
                </span>
              </span>
              <div className="min-w-0">
                <p className="text-body-md font-semibold text-on-surface">
                  {tituloAlerta(llamado)}
                </p>
                {detalle && (
                  <p className="text-body-md tabular-nums text-on-surface">
                    {detalle}
                  </p>
                )}
                <p
                  className={`flex items-center gap-1 text-body-sm ${
                    demorada
                      ? 'font-semibold text-error'
                      : 'text-on-surface-variant'
                  }`}
                >
                  {demorada && (
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[16px]"
                    >
                      schedule
                    </span>
                  )}
                  <span>{tiempoTranscurrido(llamado.ts, ahora)}</span>
                  {demorada && <span className="sr-only">, demorada</span>}
                </p>
              </div>
            </div>
            {puedeResolver && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => resolver(llamado.mesaId, 'aceptado')}
                  aria-label={`Aceptar la alerta de la mesa ${llamado.mesaNumero}`}
                  className="min-h-10 flex-1 rounded-lg bg-primary px-3 text-label-md text-on-primary hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary touch:min-h-12"
                >
                  Aceptar
                </button>
                <button
                  type="button"
                  onClick={() => resolver(llamado.mesaId, 'desestimado')}
                  aria-label={`Desestimar la alerta de la mesa ${llamado.mesaNumero}`}
                  className="min-h-10 flex-1 rounded-lg border border-outline px-3 text-label-md text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary touch:min-h-12"
                >
                  Desestimar
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
