'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface AccionMenu {
  readonly id: string;
  readonly texto: string;
  /** Nombre del ícono de Material Symbols. */
  readonly icono: string;
  readonly onSelect: () => void;
}

interface Props {
  /** Para el lector de pantalla: «Acciones de Picada Completa». */
  readonly etiqueta: string;
  readonly acciones: readonly AccionMenu[];
}

/**
 * BL-398 (parte 5): menú «⋯» con las acciones de un ítem o una categoría,
 * para el celular, donde no entran los botones de ícono de la PC.
 *
 * Accesible con teclado (patrón «menu button» de WAI-ARIA): Enter o
 * flecha abajo lo abre con el foco en la primera opción; flechas para
 * moverse, Inicio y Fin; Escape o Tab lo cierran. Al cerrar con Escape o
 * después de elegir, el foco vuelve al botón. Un clic afuera lo cierra.
 * Botón y opciones de 48 px.
 */
export function MenuAcciones({ etiqueta, acciones }: Props) {
  const [abierto, setAbierto] = useState(false);
  const idMenu = useId();
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const opciones = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ??
        [],
    );

  const cerrar = (devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) botonRef.current?.focus();
  };

  // Al abrir, el foco va a la primera opción.
  useEffect(() => {
    if (!abierto) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
  }, [abierto]);

  // Clic afuera: cierra sin mover el foco.
  useEffect(() => {
    if (!abierto) return;
    const alTocarAfuera = (e: PointerEvent) => {
      const objetivo = e.target as Node;
      if (
        !menuRef.current?.contains(objetivo) &&
        !botonRef.current?.contains(objetivo)
      ) {
        setAbierto(false);
      }
    };
    document.addEventListener('pointerdown', alTocarAfuera);
    return () => document.removeEventListener('pointerdown', alTocarAfuera);
  }, [abierto]);

  const alTeclearEnBoton = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAbierto(true);
    }
  };

  const alTeclearEnMenu = (e: React.KeyboardEvent) => {
    const lista = opciones();
    const actual = lista.indexOf(document.activeElement as HTMLButtonElement);
    const mover = (indice: number) => {
      e.preventDefault();
      lista[(indice + lista.length) % lista.length]?.focus();
    };
    if (e.key === 'ArrowDown') mover(actual + 1);
    else if (e.key === 'ArrowUp') mover(actual - 1);
    else if (e.key === 'Home') mover(0);
    else if (e.key === 'End') mover(lista.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      cerrar(true);
    } else if (e.key === 'Tab') cerrar(false);
  };

  return (
    <div className="relative">
      <button
        ref={botonRef}
        type="button"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        onClick={() => setAbierto((a) => !a)}
        onKeyDown={alTeclearEnBoton}
        className="flex h-12 w-12 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
          more_vert
        </span>
      </button>
      {abierto && (
        <ul
          ref={menuRef}
          id={idMenu}
          role="menu"
          aria-label={etiqueta}
          onKeyDown={alTeclearEnMenu}
          className="absolute right-0 z-20 mt-1 min-w-48 rounded-xl border border-outline-variant bg-surface-container-lowest py-1 shadow-lg"
        >
          {acciones.map((accion) => (
            <li key={accion.id} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  cerrar(true);
                  accion.onSelect();
                }}
                className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-body-md text-on-surface hover:bg-surface-container focus:bg-surface-container focus:outline-none"
              >
                <span className="material-symbols-outlined text-[20px] text-on-surface-variant" aria-hidden="true">
                  {accion.icono}
                </span>
                {accion.texto}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
