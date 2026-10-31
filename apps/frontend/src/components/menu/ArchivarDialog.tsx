'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';

export interface ArchivarObjetivo {
  readonly tipo: 'item' | 'categoria';
  readonly id: string;
  readonly nombre: string;
}

interface Props {
  readonly objetivo: ArchivarObjetivo | null;
  readonly onClose: () => void;
  /** Llama a la API; si falla, lanza un Error con el mensaje para mostrar. */
  readonly onConfirmar: (objetivo: ArchivarObjetivo) => Promise<void>;
}

/**
 * BL-394: confirmar el archivo de un ítem o una categoría de la carta, con el
 * mismo diálogo que Usuarios (BL-364 y BL-382) en lugar de confirm(). Si la
 * API responde 409 (por ejemplo, una categoría con ítems activos), el motivo
 * se muestra dentro del diálogo y no se cierra.
 */
export function ArchivarDialog({ objetivo, onClose, onConfirmar }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!objetivo) return null;

  const esCategoria = objetivo.tipo === 'categoria';
  const mensajeDeError = esCategoria
    ? 'No se pudo archivar la categoría'
    : 'No se pudo archivar el ítem';

  const cerrar = () => {
    setError(null);
    onClose();
  };

  const confirmar = async () => {
    setEnviando(true);
    setError(null);
    try {
      await onConfirmar(objetivo);
      cerrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : mensajeDeError);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog
      open
      onClose={cerrar}
      title={esCategoria ? 'Archivar categoría' : 'Archivar ítem'}
    >
      <div className="space-y-4">
        <p className="text-body-md text-on-surface">
          {esCategoria
            ? `¿Archivar la categoría «${objetivo.nombre}»? Deja de verse en la carta y en esta pantalla.`
            : `¿Archivar «${objetivo.nombre}»? Deja de verse en la carta y en esta pantalla.`}
        </p>
        <p className="rounded-lg bg-surface-container px-3 py-2 text-body-sm text-on-surface-variant">
          {esCategoria
            ? 'Tiene que estar sin ítems activos. Se puede restaurar después.'
            : 'Conserva sus pedidos y se puede restaurar después.'}
        </p>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
            {error}
          </p>
        )}

        {/* Mismo criterio que Usuarios: el foco inicial va a «Cancelar». */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            data-autofocus
            type="button"
            onClick={cerrar}
            className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={enviando}
            className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {enviando ? 'Archivando…' : 'Archivar'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
