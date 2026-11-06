"use client";

import {
  CLASE_BOTON,
  CLASE_BOTON_SECUNDARIO,
  CLASE_ERROR_GENERAL,
} from "./configuracion.estilos";

interface BarraGuardarProps {
  /** Id del <form> que envía «Guardar cambios» (atributo `form`). */
  formId: string;
  conCambios: boolean;
  guardando: boolean;
  /** Resultado del último guardado o descarte, para el lector de pantalla. */
  aviso: string;
  error: string | null;
  onDescartar: () => void;
}

/**
 * BL-473: barra de acciones de Configuración. Va al final de la pantalla y
 * queda fija abajo mientras se hace scroll (`sticky bottom-0` dentro del
 * contenedor con scroll del panel), así «Guardar cambios» siempre está a
 * mano y nunca queda debajo de otra sección.
 *
 * Está fuera del <form> (después de «Anonimizar datos de facturación», que
 * tiene su propio formulario): el botón de guardar se asocia con el
 * atributo `form`, que es HTML nativo y no necesita JavaScript.
 */
export default function BarraGuardar({
  formId,
  conCambios,
  guardando,
  aviso,
  error,
  onDescartar,
}: Readonly<BarraGuardarProps>) {
  const deshabilitado = guardando || !conCambios;
  let estado = aviso;
  if (!estado && conCambios) estado = "Hay cambios sin guardar.";

  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-outline-variant bg-surface/95 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        {error && (
          <p role="alert" className={CLASE_ERROR_GENERAL}>
            {error}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Mensajes de estado: el lector de pantalla los anuncia sin mover
              el foco. */}
          <p
            className="text-body-md text-on-surface-variant sm:mr-auto"
            aria-live="polite"
            aria-atomic="true"
          >
            {estado}
          </p>
          <button
            type="button"
            onClick={onDescartar}
            disabled={deshabilitado}
            className={`${CLASE_BOTON_SECUNDARIO} w-full sm:w-auto`}
          >
            Descartar cambios
          </button>
          <button
            type="submit"
            form={formId}
            disabled={deshabilitado}
            className={`${CLASE_BOTON} w-full sm:w-auto`}
          >
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
