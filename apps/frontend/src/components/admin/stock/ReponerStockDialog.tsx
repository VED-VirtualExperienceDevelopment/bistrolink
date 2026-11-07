"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Dialog } from "@/components/ui/Dialog";
import {
  CLASE_AYUDA,
  CLASE_BOTON,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  CLASE_ERROR_CAMPO,
  CLASE_ETIQUETA,
} from "@/components/admin/configuracion/configuracion.estilos";
import {
  leerUnidades,
  mensajeErrorGuardarStock,
  textoUnidades,
  type AlertaStock,
} from "./stock.utils";

/**
 * HU-015 (BL-120): «Reponer stock» desde la campana, sin salir de la
 * pantalla. Las unidades que se ingresan son las que hay ahora (no se suman
 * a las que quedaban); con más de 0 el ítem vuelve a la carta (D6).
 *
 * BL-474: campo y botones con los estilos de Configuración (borde con
 * contraste ≥ 3:1 y foco sólido); en el celular, botones a todo el ancho con
 * el mismo orden que con el teclado.
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

  // Con error, el campo también lo anuncia.
  const describidoPor = error ? `${id}-ayuda ${id}-error` : `${id}-ayuda`;

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
      // BL-483: sin el detalle técnico de la API (ver mensajeErrorGuardarStock).
      setError(mensajeErrorGuardarStock(err));
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
            <label htmlFor={`${id}-unidades`} className={CLASE_ETIQUETA}>
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
              aria-describedby={describidoPor}
              className={CLASE_CONTROL}
            />
            <p id={`${id}-ayuda`} className={`mt-1 ${CLASE_AYUDA}`}>
              Antes: {textoUnidades(alerta)}. Con más de 0, el ítem vuelve a la
              carta.
            </p>
            {error && (
              <p id={`${id}-error`} role="alert" className={CLASE_ERROR_CAMPO}>
                {error}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className={`${CLASE_BOTON_SECUNDARIO} w-full sm:w-auto`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className={`${CLASE_BOTON} w-full sm:w-auto`}
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
