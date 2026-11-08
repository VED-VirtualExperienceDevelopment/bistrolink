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

/** Sin alertas y con conexión: no hay nada que atender. */
function EstadoVacio() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant"
      >
        <span className="material-symbols-outlined text-[32px]">done_all</span>
      </span>
      <p className="text-body-md font-semibold text-on-surface">
        No hay alertas pendientes.
      </p>
      <p className="max-w-xs text-body-sm text-on-surface-variant">
        Cuando una mesa llame al mozo o pida pagar en efectivo, la vas a ver
        acá. Se actualiza sola.
      </p>
    </div>
  );
}

/**
 * Sin alertas y sin conexión: no se sabe si hay algo pendiente. Decir «no hay
 * alertas» sería dar una tranquilidad que no se puede asegurar.
 */
function EstadoSinConexion() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-tertiary-container text-on-tertiary-container"
      >
        <span className="material-symbols-outlined text-[32px]">sync</span>
      </span>
      <p className="text-body-md font-semibold text-on-surface">
        Conectando con el servidor…
      </p>
      <p className="max-w-xs text-body-sm text-on-surface-variant">
        Todavía no sabemos si hay alertas pendientes. Se muestran apenas se
        conecte.
      </p>
    </div>
  );
}

/**
 * BL-441: lista de alertas pendientes (llamados de mesa y avisos de pago en
 * efectivo). La comparten la vista rápida de la campana y la pantalla Alertas.
 *
 * El contenedor es una región viva que existe siempre, con la lista o el
 * estado vacío adentro: si la región apareciera junto con su contenido, muchos
 * lectores de pantalla no anunciarían la primera alerta ni el «no hay
 * alertas». `aria-relevant` deja afuera los cambios de texto, para que el
 * «hace X min», que se actualiza solo, no se lea cada 15 segundos.
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
  const { llamados, puedeResolver, resolver, conectado } = alertas;
  const hayAlertas = llamados.length > 0;

  let contenido;
  if (hayAlertas) {
    contenido = (
      <ul className="flex max-w-2xl flex-col gap-2">
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
  } else if (conectado) {
    contenido = <EstadoVacio />;
  } else {
    contenido = <EstadoSinConexion />;
  }

  return (
    <div aria-live="polite" aria-relevant="additions removals">
      {/* Con alertas en pantalla y sin conexión, pueden estar desactualizadas. */}
      {hayAlertas && !conectado && (
        <p className="mb-2 max-w-2xl rounded-lg bg-tertiary-container px-3 py-2 text-label-md text-on-tertiary-container">
          Sin conexión con el servidor. Reconectando… Las alertas pueden no
          estar al día.
        </p>
      )}
      {contenido}
    </div>
  );
}
