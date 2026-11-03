"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { ApiError } from "@/lib/api-client";
import { leerUnidades, textoUnidades, type AlertaStock } from "./stock.utils";

const CLASE_BOTON =
  "flex min-h-12 items-center justify-center rounded-lg px-5 text-body-md font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";

/**
 * HU-015 (BL-120): «Reponer stock» desde la campana, sin salir de la
 * pantalla. Las unidades que se ingresan son las que hay ahora (no se suman
 * a las que quedaban); con más de 0 el ítem vuelve a la carta (D6).
 */
export default function ReponerStockDialog({
  alerta,
  onClose,
  onGuardar,
}: Readonly<{
  alerta: AlertaStock | null;
  onClose: () => void;
  onGuardar: (itemId: string, stockActual: number) => Promise<void>;
}>) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const id = useId();

  // Cada vez que se abre para un ítem, el campo arranca vacío.
  useEffect(() => {
    setTexto("");
    setError(null);
    setGuardando(false);
  }, [alerta?.itemId]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!alerta) return;
    const unidades = leerUnidades(texto);
    if (!unidades.ok) {
      setError(unidades.error);
      return;
    }
    setGuardando(true);
    try {
      await onGuardar(alerta.itemId, unidades.valor);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo guardar el stock",
      );
      setGuardando(false);
    }
  }

  return (
    <Dialog
      open={alerta !== null}
      onClose={onClose}
      title={alerta ? `Reponer stock: ${alerta.nombre}` : "Reponer stock"}
    >
      {alerta && (
        <form onSubmit={guardar} noValidate className="space-y-4">
          <div>
            <label
              htmlFor={`${id}-unidades`}
              className="mb-1 block text-label-md text-on-surface-variant"
            >
              Unidades disponibles ahora
            </label>
            <input
              id={`${id}-unidades`}
              data-autofocus
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setError(null);
              }}
              aria-invalid={error !== null}
              aria-describedby={`${id}-ayuda${error ? ` ${id}-error` : ""}`}
              className="min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-error"
            />
            <p
              id={`${id}-ayuda`}
              className="mt-1 text-body-sm text-on-surface-variant"
            >
              Antes: {textoUnidades(alerta)}. Con más de 0, el ítem vuelve a la
              carta.
            </p>
            {error && (
              <p
                id={`${id}-error`}
                role="alert"
                className="mt-1 text-body-sm text-error"
              >
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`${CLASE_BOTON} border border-outline-variant text-on-surface hover:bg-surface-container-low`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className={`${CLASE_BOTON} bg-primary text-on-primary hover:opacity-90`}
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
