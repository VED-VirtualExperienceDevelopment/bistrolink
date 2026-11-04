"use client";

import { useEffect, useState } from "react";
import { haceCuanto } from "./reportes.utils";
import { CLASE_BOTON_SECUNDARIO } from "./reportes.estilos";

/** Cada cuánto se reescribe «actualizado hace N s». */
const INTERVALO_RELOJ_MS = 5000;

/**
 * HU-012 (BL-108): indicador «En vivo», hora de la última actualización y
 * botón «Actualizar» (por si se corta la conexión). El anuncio de los datos
 * nuevos va en una región aria-live, discreta.
 */
export default function EstadoEnVivo({
  enVivo,
  actualizadoEn,
  actualizando,
  anuncio,
  onActualizar,
}: Readonly<{
  enVivo: boolean;
  actualizadoEn: Date | null;
  actualizando: boolean;
  anuncio: string;
  onActualizar: () => void;
}>) {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const reloj = setInterval(() => setAhora(new Date()), INTERVALO_RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-body-md text-on-surface-variant">
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full ${enVivo ? "animate-pulse bg-green-600" : "bg-outline"}`}
        />
        <span>
          {enVivo ? "En vivo" : "Sin conexión en tiempo real"}
          {actualizadoEn &&
            ` · actualizado ${haceCuanto(actualizadoEn, ahora)}`}
        </span>
      </p>
      <button
        type="button"
        onClick={onActualizar}
        disabled={actualizando}
        className={CLASE_BOTON_SECUNDARIO}
      >
        <span
          aria-hidden="true"
          className={`material-symbols-outlined text-[20px] ${actualizando ? "animate-spin" : ""}`}
        >
          refresh
        </span>
        {actualizando ? "Actualizando…" : "Actualizar"}
      </button>
      <p className="sr-only" aria-live="polite">
        {anuncio}
      </p>
    </div>
  );
}
