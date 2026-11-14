"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { getKeycloak } from "@/lib/keycloak";
import { Dialog } from "@/components/ui/Dialog";
import Switch from "@/components/ui/Switch";
import ImageUploader from "./ImageUploader";
import {
  errorNombreItem,
  errorPrecioItem,
  esConflictoDeEdicion,
  normalizarPrecio,
  type ItemGestion,
} from "./gestion-carta.utils";

interface ItemFormModalProps {
  readonly categoriaId: string;
  readonly categoriaNombre: string;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
  readonly itemToEdit?: ItemGestion;
  /** BL-398: conflicto de edición; la página recarga la carta. */
  readonly onRecargar?: () => void;
}

const CLASE_INPUT =
  "min-h-12 w-full rounded-lg border px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

/**
 * Alta y edición de un ítem de la carta.
 *
 * BL-398 (parte 4b): pasa al diálogo del tema (como Usuarios y la
 * categoría), con los errores junto a cada campo y las mismas reglas que el
 * backend. Al editar manda la versión (`updatedAt`) para el bloqueo
 * optimista (BL-394): si otra persona guardó antes, ofrece recargar.
 */
export default function ItemFormModal({
  categoriaId,
  categoriaNombre,
  onClose,
  onSuccess,
  itemToEdit,
  onRecargar,
}: ItemFormModalProps) {
  const [nombre, setNombre] = useState(itemToEdit?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(itemToEdit?.descripcion ?? "");
  const [precio, setPrecio] = useState(itemToEdit?.precio ?? "");
  const [disponible, setDisponible] = useState(itemToEdit?.disponible ?? true);
  // HU-044 (BL-537): «Sugerencia del local».
  const [destacado, setDestacado] = useState(itemToEdit?.destacado ?? false);
  const [imagenKey, setImagenKey] = useState<string | null>(
    itemToEdit?.imagenKey ?? null,
  );
  const [imagenPreview, setImagenPreview] = useState<string | null>(
    itemToEdit?.imagenUrl ?? null,
  );
  const [intentoGuardar, setIntentoGuardar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState(false);

  // Los errores de cada campo se muestran recién después del primer intento
  // de guardar, para no marcar en rojo lo que todavía no se completó.
  const errorNombre = intentoGuardar ? errorNombreItem(nombre) : null;
  const errorPrecio = intentoGuardar ? errorPrecioItem(precio) : null;

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setIntentoGuardar(true);
    const primerError = [
      ["item-nombre", errorNombreItem(nombre)],
      ["item-precio", errorPrecioItem(precio)],
    ].find(([, mensaje]) => mensaje);
    if (primerError) {
      document.getElementById(primerError[0] as string)?.focus();
      return;
    }

    setEnviando(true);
    setError(null);
    setConflicto(false);
    try {
      const keycloak = getKeycloak();
      const datos = {
        categoriaId,
        nombre: nombre.trim(),
        // Vacía se manda igual, para poder borrar una descripción al editar.
        descripcion: descripcion.trim(),
        precio: normalizarPrecio(precio),
        disponible,
        destacado,
        imagenKey: imagenKey || undefined,
      };

      if (itemToEdit) {
        await apiFetch(`/admin/menu/item/${itemToEdit.id}`, keycloak.token, {
          method: "PATCH",
          body: JSON.stringify({ ...datos, updatedAt: itemToEdit.updatedAt }),
        });
      } else {
        await apiFetch("/admin/menu/item", keycloak.token, {
          method: "POST",
          body: JSON.stringify(datos),
        });
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      setConflicto(esConflictoDeEdicion(err));
      setError(
        err instanceof Error ? err.message : "No se pudo guardar el ítem",
      );
    } finally {
      setEnviando(false);
    }
  };

  const recargar = () => {
    onRecargar?.();
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={itemToEdit ? "Editar ítem" : "Nuevo ítem"}
      tamano="lg"
    >
      <form onSubmit={guardar} className="space-y-4" noValidate>
        <p className="text-body-md text-on-surface-variant">
          Categoría: {categoriaNombre}
        </p>

        <div>
          <label htmlFor="item-nombre" className="mb-1 block text-label-md text-on-surface-variant">
            Nombre
          </label>
          <input
            id="item-nombre"
            aria-required
            autoComplete="off"
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value);
              setError(null);
            }}
            placeholder="Por ejemplo: Milanesa napolitana"
            aria-invalid={errorNombre ? true : undefined}
            aria-describedby={errorNombre ? "item-nombre-error" : undefined}
            className={`${CLASE_INPUT} ${errorNombre ? "border-error" : "border-outline-variant"}`}
          />
          {errorNombre && (
            <p id="item-nombre-error" className="mt-1 text-body-sm text-error">
              {errorNombre}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="item-descripcion" className="mb-1 block text-label-md text-on-surface-variant">
            Descripción (opcional)
          </label>
          <textarea
            id="item-descripcion"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            placeholder="Por ejemplo: con jamón, queso y salsa de tomate"
            className={`${CLASE_INPUT} resize-none border-outline-variant py-2`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="item-precio" className="mb-1 block text-label-md text-on-surface-variant">
              Precio
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-body-md text-on-surface-variant"
              >
                $
              </span>
              {/* Texto y no number: acepta «590,50» con coma, como se
                  escribe en Uruguay, y no cambia el valor con la rueda del
                  mouse. */}
              <input
                id="item-precio"
                aria-required
                inputMode="decimal"
                autoComplete="off"
                value={precio}
                onChange={(e) => {
                  setPrecio(e.target.value);
                  setError(null);
                }}
                placeholder="590"
                aria-invalid={errorPrecio ? true : undefined}
                aria-describedby={errorPrecio ? "item-precio-error" : undefined}
                className={`${CLASE_INPUT} pl-7 ${errorPrecio ? "border-error" : "border-outline-variant"}`}
              />
            </div>
            {errorPrecio && (
              <p id="item-precio-error" className="mt-1 text-body-sm text-error">
                {errorPrecio}
              </p>
            )}
          </div>

          <div>
            <span id="item-disponible-etiqueta" className="mb-1 block text-label-md text-on-surface-variant">
              Disponible
            </span>
            <div className="flex min-h-12 items-center gap-3">
              <Switch
                checked={disponible}
                onChange={setDisponible}
                label="Disponible para pedir"
              />
              <span className="text-body-md text-on-surface">
                {disponible ? "Sí" : "No, agotado"}
              </span>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">
              Sugerencia del local
            </span>
            <div className="flex min-h-12 items-center gap-3">
              <Switch
                checked={destacado}
                onChange={setDestacado}
                label="Sugerencia del local"
              />
              <span className="text-body-md text-on-surface">
                {destacado ? "Sí, se destaca en la carta" : "No"}
              </span>
            </div>
          </div>
        </div>

        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">
            Imagen (opcional)
          </span>
          <ImageUploader
            onUploadSuccess={(key, previewUrl) => {
              setImagenKey(key);
              setImagenPreview(previewUrl);
            }}
            initialPreviewUrl={imagenPreview || undefined}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
            <p>{error}</p>
            {conflicto && onRecargar && (
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
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
