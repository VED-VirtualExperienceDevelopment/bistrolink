'use client';

import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape para cerrar. Separado del efecto de foco a propósito: onClose
  // se recrea en cada render del padre (no está memoizado con useCallback),
  // así que si este listener y el foco compartieran un solo efecto con
  // [open, onClose] en las dependencias, CADA letra tipeada en un input
  // del diálogo disparaba el efecto de nuevo — y panelRef.current.focus()
  // le robaba el foco al input en cada tecla.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Foco inicial: solo cuando el diálogo pasa de cerrado a abierto, no en
  // cada re-render mientras está abierto.
  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
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
        aria-labelledby="dialog-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-outline-variant bg-surface-container-lowest p-6 shadow-lg outline-none"
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 id="dialog-title" className="text-headline-sm text-on-surface">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}