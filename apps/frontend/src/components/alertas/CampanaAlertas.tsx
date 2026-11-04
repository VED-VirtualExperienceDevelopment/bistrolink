'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAlertas } from './AlertasProvider';
import { ListaAlertas } from './ListaAlertas';
import { etiquetaCampana, textoContador } from './alertas.utils';

// Dos ciclos de 1,2 s (ver `animation.campana` en tailwind.config.ts).
const DURACION_ANIMACION_MS = 2500;
const RUTA_ALERTAS = '/admin/alertas';

/**
 * BL-441: campana del encabezado. Muestra el contador de pendientes y abre una
 * vista rápida de las alertas, para aceptarlas o desestimarlas sin salir de la
 * pantalla en la que se está. La vista rápida es pasajera: se cierra sola con
 * un clic afuera, con Esc o al cambiar de pantalla, y no queda abierta junto a
 * otra pantalla. «Ver todas las alertas» lleva a la pantalla Alertas del menú.
 *
 * Patrón disclosure de WAI-ARIA APG: un botón con aria-expanded que muestra y
 * oculta contenido, sin quitarle el foco al resto de la página.
 *
 * El color y el contador llevan la información; la animación solo llama la
 * atención, y se desactiva con `prefers-reduced-motion`.
 */
export function CampanaAlertas() {
  const alertas = useAlertas();
  const pathname = usePathname();
  const contenedorRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const llegadas = alertas?.llegadas ?? 0;
  const abierta = Boolean(alertas?.panelAbierto);
  const cerrar = alertas?.cerrarPanel;
  const [agitando, setAgitando] = useState(false);

  // Se agita solo cuando llega un llamado nuevo; al cerrar la vista rápida
  // después no vuelve a agitarse.
  useEffect(() => {
    if (llegadas === 0) return;
    setAgitando(true);
    const espera = setTimeout(() => setAgitando(false), DURACION_ANIMACION_MS);
    return () => clearTimeout(espera);
  }, [llegadas]);

  // Cambiar de pantalla cierra la vista rápida.
  useEffect(() => {
    cerrar?.();
  }, [pathname, cerrar]);

  // Clic o toque afuera, y Esc: cierran. Con Esc, el foco vuelve a la campana
  // si estaba dentro de la vista rápida.
  useEffect(() => {
    if (!abierta || !cerrar) return;
    const alTocarAfuera = (e: PointerEvent) => {
      if (!contenedorRef.current?.contains(e.target as Node)) cerrar();
    };
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const estabaAdentro = contenedorRef.current?.contains(
        document.activeElement,
      );
      cerrar();
      if (estabaAdentro) botonRef.current?.focus();
    };
    document.addEventListener('pointerdown', alTocarAfuera);
    document.addEventListener('keydown', alPresionar);
    return () => {
      document.removeEventListener('pointerdown', alTocarAfuera);
      document.removeEventListener('keydown', alPresionar);
    };
  }, [abierta, cerrar]);

  if (!alertas) return null;

  const { cantidad, alternarPanel } = alertas;
  const hayAlertas = cantidad > 0;
  const agitar = agitando && !abierta;
  const enPantallaAlertas = pathname.startsWith(RUTA_ALERTAS);

  return (
    <div ref={contenedorRef} className="relative">
      <button
        ref={botonRef}
        type="button"
        onClick={alternarPanel}
        aria-expanded={abierta}
        aria-label={etiquetaCampana(cantidad)}
        title="Alertas"
        className={`relative flex min-h-12 min-w-12 select-none items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          hayAlertas
            ? 'bg-tertiary-container text-on-tertiary-container'
            : 'text-on-surface-variant hover:bg-surface-container-low'
        }`}
      >
        <span
          key={llegadas}
          aria-hidden="true"
          className={`material-symbols-outlined origin-top ${
            agitar ? 'animate-campana motion-reduce:animate-none' : ''
          }`}
        >
          {hayAlertas ? 'notifications_active' : 'notifications'}
        </span>
        {hayAlertas && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-error px-1 text-label-md tabular-nums text-on-error ring-2 ring-surface"
          >
            {textoContador(cantidad)}
          </span>
        )}
      </button>

      {abierta && (
        <section
          id="vista-rapida-alertas"
          aria-label="Alertas pendientes"
          className="z-30 flex max-h-[70vh] flex-col rounded-xl border border-outline-variant bg-surface-container-lowest shadow-xl max-lg:fixed max-lg:inset-x-2 max-lg:top-[72px] lg:absolute lg:right-0 lg:top-full lg:mt-2 lg:w-[360px]"
        >
          <h2 className="shrink-0 border-b border-outline-variant px-4 py-3 text-headline-sm text-on-surface">
            Alertas
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ListaAlertas />
          </div>
          {!enPantallaAlertas && (
            <div className="shrink-0 border-t border-outline-variant p-2">
              <Link
                href={RUTA_ALERTAS}
                className="flex min-h-12 items-center justify-center rounded-lg text-label-md text-primary hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Ver todas las alertas
              </Link>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
