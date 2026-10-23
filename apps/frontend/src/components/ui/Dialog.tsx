'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * BL-408: ancho máximo. `md` (por defecto, 448 px) para confirmaciones y
   * formularios cortos; `lg` (768 px) para formularios con varias secciones,
   * como el alta de un establecimiento. En el celular, los dos ocupan el
   * ancho de la pantalla.
   */
  tamano?: 'md' | 'lg';
}

const ANCHO: Record<NonNullable<DialogProps['tamano']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-3xl',
};

// Elementos que reciben foco con Tab dentro del panel.
const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal. BL-364 (accesibilidad, criterios del mapa de mesas y el
 * login):
 * - Al abrir, el foco va al elemento marcado con `data-autofocus`; si no hay,
 *   al primer campo del formulario; si tampoco, al panel.
 * - Tab y Shift+Tab quedan dentro del diálogo mientras está abierto.
 * - Esc cierra, y al cerrar el foco vuelve al elemento que lo abrió (si
 *   sigue en la página).
 * - El botón de cerrar mide 48 px.
 *
 * BL-408: el título y el botón de cerrar quedan fijos arriba y solo se
 * desplaza el contenido (antes se iban con el scroll, y en un formulario
 * largo no se sabía en qué diálogo se estaba). El alto usa `dvh`, que en el
 * celular descuenta la barra del navegador.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  tamano = 'md',
}: Readonly<DialogProps>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const idTitulo = useId();

  // Escape para cerrar y Tab atrapado en el panel. Separado del efecto de
  // foco a propósito: onClose se recrea en cada render del padre (no está
  // memoizado con useCallback), así que si este listener y el foco
  // compartieran un solo efecto con [open, onClose] en las dependencias,
  // CADA letra tipeada en un input del diálogo disparaba el efecto de nuevo
  // — y el foco inicial le robaba el foco al input en cada tecla.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const enfocables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(ENFOCABLES),
      );
      if (enfocables.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = enfocables[0];
      const ultimo = enfocables.at(-1) ?? primero;
      const activo = document.activeElement;
      if (e.shiftKey && (activo === primero || activo === panelRef.current)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Foco inicial y devolución del foco: solo cuando el diálogo pasa de
  // cerrado a abierto (y al revés), no en cada re-render mientras está abierto.
  useEffect(() => {
    if (!open) return;
    const anterior =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const destino =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ) ??
      panel;
    destino?.focus();
    return () => {
      // Al cerrar, el foco vuelve a quien abrió el diálogo, si todavía está
      // en la página (por ejemplo, la fila de un usuario recién desactivado
      // puede desaparecer con el filtro «Activos»).
      if (anterior?.isConnected) anterior.focus();
    };
  }, [open]);

  if (!open) return null;

  // Cerrar al hacer clic en el fondo (no en el panel). En vez de un onClick
  // "stopPropagation" en el panel (que dispara la regla de accesibilidad
  // click-events-have-key-events al no tener un manejador de teclado
  // equivalente), comparamos target === currentTarget acá: solo cierra si
  // el clic fue directamente sobre el fondo, no si vino de un hijo.
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  const handleBackdropKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || e.key === 'Enter') onClose();
  };

  return (
    <div
      role="presentation"
      onClick={handleBackdropClick}
      onKeyDown={handleBackdropKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 p-4"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-2rem)] w-full ${ANCHO[tamano]} flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-lg outline-none`}
      >
        <div className="flex flex-none items-start justify-between gap-2 border-b border-outline-variant px-6 pb-3 pt-6">
          <h2 id={idTitulo} className="text-headline-sm text-on-surface">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-2 flex h-12 w-12 flex-none items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
          {children}
        </div>
      </div>
    </div>
  );
}
