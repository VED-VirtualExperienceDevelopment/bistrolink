"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { getKeycloak } from "@/lib/keycloak";
import ImageUploader from "./ImageUploader";

interface Item {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion?: string;
  readonly precio: string;
  readonly disponible: boolean;
  readonly imagenKey?: string;
  readonly imagenUrl?: string | null;
  readonly categoriaId: string;
}

interface ItemFormModalProps {
  readonly categoriaId: string;
  readonly categoriaNombre: string;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
  readonly itemToEdit?: Item;
}

export default function ItemFormModal({
  categoriaId,
  categoriaNombre,
  onClose,
  onSuccess,
  itemToEdit,
}: ItemFormModalProps) {
  const [nombre, setNombre] = useState(itemToEdit?.nombre || "");
  const [descripcion, setDescripcion] = useState(itemToEdit?.descripcion || "");
  const [precio, setPrecio] = useState(itemToEdit?.precio || "");
  const [disponible, setDisponible] = useState(itemToEdit?.disponible ?? true);
  const [imagenKey, setImagenKey] = useState<string | null>(
    itemToEdit?.imagenKey || null,
  );
  const [imagenPreview, setImagenPreview] = useState<string | null>(
    itemToEdit?.imagenUrl ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const keycloak = getKeycloak();
      const payload = {
        categoriaId,
        nombre,
        descripcion: descripcion || undefined,
        precio,
        disponible,
        imagenKey: imagenKey || undefined,
      };

      if (itemToEdit) {
        await apiFetch(`/admin/menu/item/${itemToEdit.id}`, keycloak.token, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/admin/menu/item", keycloak.token, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Error al guardar el ítem. Intente nuevamente.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-[#7C7296]">
              {itemToEdit ? "Editar Ítem" : "Nuevo Ítem"}
            </h2>
            <p className="text-sm text-[#79767D] mt-1">
              Categoría: {categoriaNombre}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#79767D] hover:text-[#7C7296] transition-colors"
            aria-label="Cerrar modal"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="item-imagen"
              className="block text-sm font-medium text-[#7C7296] mb-2"
            >
              Imagen del producto
            </label>
            <div id="item-imagen">
              <ImageUploader
                onUploadSuccess={(key, previewUrl) => {
                  setImagenKey(key);
                  setImagenPreview(previewUrl);
                }}
                initialPreviewUrl={imagenPreview || undefined}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="item-nombre"
              className="block text-sm font-medium text-[#7C7296] mb-2"
            >
              Nombre *
            </label>
            <input
              id="item-nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              className="w-full px-4 py-2 border border-[#79767D]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8069BF] focus:border-transparent"
              placeholder="Ej: Milanesa Napolitana"
            />
          </div>

          <div>
            <label
              htmlFor="item-descripcion"
              className="block text-sm font-medium text-[#7C7296] mb-2"
            >
              Descripción
            </label>
            <textarea
              id="item-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-[#79767D]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8069BF] focus:border-transparent resize-none"
              placeholder="Ej: Con jamón, queso y salsa de tomate"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="item-precio"
                className="block text-sm font-medium text-[#7C7296] mb-2"
              >
                Precio *
              </label>
              <input
                id="item-precio"
                type="number"
                step="0.01"
                min="0"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                required
                className="w-full px-4 py-2 border border-[#79767D]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8069BF] focus:border-transparent"
                placeholder="15.50"
              />
            </div>
            <div>
              <label
                htmlFor="item-disponible"
                className="block text-sm font-medium text-[#7C7296] mb-2"
              >
                Disponible
              </label>
              <div className="flex items-center gap-3 h-[42px]">
                <button
                  id="item-disponible"
                  type="button"
                  role="switch"
                  aria-checked={disponible}
                  onClick={() => setDisponible(!disponible)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${disponible ? "bg-[#8069BF]" : "bg-[#79767D]"}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${disponible ? "translate-x-5" : "translate-x-0"}`}
                  />
                </button>
                <span className="text-sm text-[#79767D]">
                  {disponible ? "Sí" : "No"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[#79767D]/30 text-[#7C7296] rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-[#8069BF] text-white rounded-lg hover:bg-[#8069BF]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {itemToEdit ? "Guardar cambios" : "Crear ítem"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
