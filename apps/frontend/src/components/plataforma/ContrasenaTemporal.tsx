"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { avisoCopiaContrasena } from "./plataforma.utils";

// BL-408: botones de 48 px, como el alta.
export const CLASE_BOTON_PRIMARIO =
  "flex min-h-12 items-center justify-center rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50";
export const CLASE_BOTON_SECUNDARIO =
  "flex min-h-12 items-center justify-center rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container";

interface ContrasenaProps {
  /** Para los ids del código y del botón. */
  idBase: string;
  contrasena: string;
  /** «Ana Gómez»: de quién es, para el botón y el aviso. */
  deQuien: string;
  copiada: boolean;
  onCopiada: () => void;
  /** Al botón «Copiar» (React 19: ref como prop). */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * BL-414: contraseña temporal que se muestra una sola vez, con «Copiar».
 * Mismo criterio que el alta (BL-408): cada copia se anuncia al lector de
 * pantalla, y si el navegador no deja usar el portapapeles (permiso
 * denegado, página sin HTTPS), la contraseña queda seleccionada para
 * copiarla con Ctrl+C, en lugar de fallar en silencio.
 *
 * El ref va al botón «Copiar»: el diálogo le pone el foco al mostrar la
 * contraseña, porque el formulario o la confirmación desaparecen.
 */
export function ContrasenaTemporal({
  idBase,
  contrasena,
  deQuien,
  copiada,
  onCopiada,
  ref,
}: Readonly<ContrasenaProps>) {
  const [aviso, setAviso] = useState("");
  const idCodigo = `${idBase}-contrasena`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(contrasena);
      onCopiada();
      setAviso(avisoCopiaContrasena(deQuien, true));
    } catch {
      const codigo = document.getElementById(idCodigo);
      if (codigo) globalThis.getSelection()?.selectAllChildren(codigo);
      setAviso(avisoCopiaContrasena(deQuien, false));
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
        <code id={idCodigo} className="break-all text-body-md text-on-surface">
          {contrasena}
        </code>
        {/* El nombre accesible empieza con el texto visible y dice de quién
            es la contraseña. */}
        <button
          ref={ref}
          id={`${idBase}-copiar`}
          type="button"
          onClick={copiar}
          aria-label={`${copiada ? "Copiada" : "Copiar"}: contraseña de ${deQuien}`}
          className="flex min-h-12 shrink-0 items-center gap-1 rounded-lg px-3 text-body-md font-semibold text-primary hover:bg-surface-container-high"
        >
          <span
            className="material-symbols-outlined text-[20px]"
            aria-hidden="true"
          >
            {copiada ? "check" : "content_copy"}
          </span>
          <span aria-hidden="true">{copiada ? "Copiada" : "Copiar"}</span>
        </button>
      </div>
      {/* Siempre en el DOM para que el cambio se anuncie. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {aviso}
      </p>
    </>
  );
}

/**
 * BL-414 (criterio de BL-408): si la contraseña no se copió, cerrar el
 * diálogo pide confirmación, porque no se puede volver a ver. El foco va a
 * «Volver a la contraseña», la opción que no pierde nada.
 */
export function ConfirmarCierreSinCopiar({
  onCerrarIgual,
  onVolver,
}: Readonly<{ onCerrarIgual: () => void; onVolver: () => void }>) {
  const volver = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    volver.current?.focus();
  }, []);

  return (
    <div
      role="alert"
      className="space-y-3 rounded-lg border border-error bg-error-container px-4 py-3 text-on-error-container"
    >
      <p className="text-body-md">
        <strong>La contraseña no se copió.</strong> Si cerrás, no se puede
        volver a ver: habría que restablecerla de nuevo.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCerrarIgual}
          className={CLASE_BOTON_SECUNDARIO}
        >
          Cerrar igual
        </button>
        <button
          ref={volver}
          type="button"
          onClick={onVolver}
          className={CLASE_BOTON_PRIMARIO}
        >
          Volver a la contraseña
        </button>
      </div>
    </div>
  );
}
