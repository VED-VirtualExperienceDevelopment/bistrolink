'use client';

import { useEffect, useState } from 'react';
import { DURACION_DESHACER_MS } from '@/components/admin/mesas/deshacer.utils';

interface Props {
  /** Texto del aviso, o null si no hay nada para deshacer. */
  readonly texto: string | null;
  readonly onDeshacer: () => void;
  /** Se llama cuando el aviso se cierra solo. */
  readonly onVencer: () => void;
}

/**
 * BL-398 (parte 5): aviso «Deshacer» después de archivar, igual al del mapa
 * de mesas (BL-332): abajo de la pantalla, se cierra solo a los
 * DURACION_DESHACER_MS salvo mientras tiene el foco o el puntero encima
 * (WCAG 2.2.1). El <output> (rol status) está siempre en la página para que
 * el lector de pantalla anuncie qué se archivó.
 */
export function AvisoDeshacer({ texto, onDeshacer, onVencer }: Props) {
  const [enUso, setEnUso] = useState(false);

  useEffect(() => {
    if (!texto || enUso) return;
    const temporizador = setTimeout(onVencer, DURACION_DESHACER_MS);
    return () => clearTimeout(temporizador);
  }, [texto, enUso, onVencer]);

  return (
    <output className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 empty:hidden">
      {texto && (
        <div
          className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl bg-inverse-surface py-1 pl-4 pr-1 text-inverse-on-surface shadow-lg"
          onMouseEnter={() => setEnUso(true)}
          onMouseLeave={() => setEnUso(false)}
          onFocus={() => setEnUso(true)}
          onBlur={(ev) => {
            if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) {
              setEnUso(false);
            }
          }}
        >
          <span className="text-body-md">{texto}</span>
          <button
            type="button"
            onClick={() => {
              setEnUso(false);
              onDeshacer();
            }}
            className="min-h-12 rounded-full px-4 text-label-md font-semibold text-inverse-primary transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-inverse-primary"
          >
            Deshacer
          </button>
        </div>
      )}
    </output>
  );
}
