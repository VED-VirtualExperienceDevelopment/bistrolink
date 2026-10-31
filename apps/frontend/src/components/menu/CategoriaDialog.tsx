'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch } from '@/lib/api-client';
import { getKeycloak } from '@/lib/keycloak';
import {
  errorNombreCategoria,
  esConflictoDeEdicion,
  LARGO_MAXIMO_DESCRIPCION_CATEGORIA,
  LARGO_MAXIMO_NOMBRE_CATEGORIA,
  type CategoriaGestion,
} from './gestion-carta.utils';

/** Crear una categoría nueva o editar una existente. */
export type CategoriaEnDialogo =
  | { readonly modo: 'crear' }
  | { readonly modo: 'editar'; readonly categoria: CategoriaGestion };

interface Props {
  readonly objetivo: CategoriaEnDialogo | null;
  readonly onClose: () => void;
  /** Después de guardar: la página vuelve a cargar la carta. */
  readonly onGuardada: (nombre: string) => void;
  /** Conflicto de edición: la página recarga para ver los cambios. */
  readonly onRecargar: () => void;
}

const CLASE_INPUT =
  'min-h-12 w-full rounded-lg border px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

/**
 * BL-398 (parte 4): alta y edición de una categoría en el diálogo del tema,
 * como los de Usuarios. Antes solo se podía crear (no había forma de
 * renombrar). Suma la descripción (BL-393) y manda la versión para el
 * bloqueo optimista (BL-394): si otra persona guardó antes, ofrece recargar.
 *
 * El campo «Posición» queda hasta que la carta se ordene con Subir / Bajar
 * (BL-399).
 */
export function CategoriaDialog({
  objetivo,
  onClose,
  onGuardada,
  onRecargar,
}: Props) {
  const editando = objetivo?.modo === 'editar' ? objetivo.categoria : null;
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [orden, setOrden] = useState('0');
  const [intentoGuardar, setIntentoGuardar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState(false);

  // Cada vez que se abre, el formulario arranca con los datos de la
  // categoría (o vacío, si es nueva).
  useEffect(() => {
    if (!objetivo) return;
    setNombre(editando?.nombre ?? '');
    setDescripcion(editando?.descripcion ?? '');
    setOrden(String(editando?.orden ?? 0));
    setIntentoGuardar(false);
    setError(null);
    setConflicto(false);
  }, [objetivo, editando]);

  if (!objetivo) return null;

  const errorNombre = intentoGuardar ? errorNombreCategoria(nombre) : null;

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setIntentoGuardar(true);
    if (errorNombreCategoria(nombre)) {
      document.getElementById('categoria-nombre')?.focus();
      return;
    }
    setEnviando(true);
    setError(null);
    setConflicto(false);
    const cuerpo = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      orden: Math.max(0, Number.parseInt(orden, 10) || 0),
    };
    try {
      const keycloak = getKeycloak();
      if (editando) {
        await apiFetch(`/admin/menu/categoria/${editando.id}`, keycloak.token, {
          method: 'PATCH',
          body: JSON.stringify({ ...cuerpo, updatedAt: editando.updatedAt }),
        });
      } else {
        await apiFetch('/admin/menu/categoria', keycloak.token, {
          method: 'POST',
          body: JSON.stringify(cuerpo),
        });
      }
      onGuardada(cuerpo.nombre);
      onClose();
    } catch (err) {
      setConflicto(esConflictoDeEdicion(err));
      setError(
        err instanceof Error ? err.message : 'No se pudo guardar la categoría',
      );
    } finally {
      setEnviando(false);
    }
  };

  const recargar = () => {
    onRecargar();
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={editando ? 'Editar categoría' : 'Nueva categoría'}
    >
      <form onSubmit={guardar} className="space-y-4" noValidate>
        <div>
          <label htmlFor="categoria-nombre" className="mb-1 block text-label-md text-on-surface-variant">
            Nombre
          </label>
          <input
            id="categoria-nombre"
            aria-required
            maxLength={LARGO_MAXIMO_NOMBRE_CATEGORIA}
            autoComplete="off"
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value);
              setError(null);
            }}
            placeholder="Por ejemplo: Entradas, Postres"
            aria-invalid={errorNombre ? true : undefined}
            aria-describedby={errorNombre ? 'categoria-nombre-error' : undefined}
            className={`${CLASE_INPUT} ${errorNombre ? 'border-error' : 'border-outline-variant'}`}
          />
          {errorNombre && (
            <p id="categoria-nombre-error" className="mt-1 text-body-sm text-error">
              {errorNombre}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="categoria-descripcion" className="mb-1 block text-label-md text-on-surface-variant">
            Descripción (opcional)
          </label>
          <input
            id="categoria-descripcion"
            maxLength={LARGO_MAXIMO_DESCRIPCION_CATEGORIA}
            autoComplete="off"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Por ejemplo: Para compartir"
            aria-describedby="categoria-descripcion-ayuda"
            className={`${CLASE_INPUT} border-outline-variant`}
          />
          <p id="categoria-descripcion-ayuda" className="mt-1 text-body-sm text-on-surface-variant">
            Se muestra debajo del nombre en la carta.
          </p>
        </div>

        <div>
          <label htmlFor="categoria-orden" className="mb-1 block text-label-md text-on-surface-variant">
            Posición
          </label>
          <input
            id="categoria-orden"
            type="number"
            min={0}
            inputMode="numeric"
            value={orden}
            onChange={(e) => setOrden(e.target.value)}
            aria-describedby="categoria-orden-ayuda"
            className={`${CLASE_INPUT} border-outline-variant`}
          />
          <p id="categoria-orden-ayuda" className="mt-1 text-body-sm text-on-surface-variant">
            Las categorías se muestran de menor a mayor.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
            <p>{error}</p>
            {conflicto && (
              <button
                type="button"
                onClick={recargar}
                className="min-h-12 rounded-lg px-3 font-medium underline hover:opacity-80"
              >
                Recargar la carta
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando}
            className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {enviando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
