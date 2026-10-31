'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import type { ArchivarObjetivo as Objetivo } from './ArchivarDialog';

interface Props {
  readonly objetivo: Objetivo | null;
  readonly onClose: () => void;
  /** Llama a la API; si falla, lanza un Error con el mensaje para mostrar. */
  readonly onConfirmar: (objetivo: Objetivo) => Promise<void>;
}

/**
 * BL-398 (parte 3): eliminar definitivamente un ítem o una categoría
 * archivados. Mismo diálogo que «Eliminar usuario» (BL-382): no se puede
 * deshacer, así que el foco inicial va a «Cancelar» y el botón es de error.
 * Si la API responde 409 (por ejemplo, un pedido nuevo con ese ítem), el
 * motivo se muestra dentro del diálogo.
 */
export function EliminarDefinitivoDialog({
  objetivo,
  onClose,
  onConfirmar,
}: Props) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!objetivo) return null;

  const esCategoria = objetivo.tipo === 'categoria';
  const mensajeDeError = esCategoria
    ? 'No se pudo eliminar la categoría'
    : 'No se pudo eliminar el ítem';

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
      title={esCategoria ? 'Eliminar categoría' : 'Eliminar ítem'}
    >
      <div className="space-y-4">
        <p className="text-body-md text-on-surface">
          {esCategoria
            ? `¿Eliminar la categoría «${objetivo.nombre}»? Se borra de la carta.`
            : `¿Eliminar «${objetivo.nombre}»? Se borra de la carta.`}
        </p>
        <p className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
          No se puede deshacer. Si solo querés sacarlo de la carta por un
          tiempo, dejalo archivado.
        </p>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
            {error}
          </p>
        )}

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
            className="min-h-12 rounded-lg bg-error px-4 text-body-md font-medium text-on-error hover:opacity-90 disabled:opacity-50"
          >
            {enviando ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
