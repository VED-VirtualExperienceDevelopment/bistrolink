"use client";

import { useId } from "react";
import {
  LARGO_MAXIMO_CONTACTO_RETIRO,
  LARGO_MAXIMO_NOMBRE_RETIRO,
  type FormularioContactoRetiro as Formulario,
} from "./retiro.utils";

interface Props {
  readonly valor: Formulario;
  readonly onChange: (valor: Formulario) => void;
  readonly error: string | null;
  readonly rutaPrivacidad: string;
  readonly deshabilitado?: boolean;
}

const CLASE_CAMPO =
  "w-full p-3 rounded-lg text-sm outline-none border-2 border-culinary-neutral/30 bg-culinary-background focus:border-[#6e54ad] focus:ring-2 focus:ring-[#6e54ad]/20 placeholder:text-[#5a575e]/70";

/**
 * HU-040 (BL-210): nombre y contacto del comensal en un pedido para retirar.
 * Es opcional: sin consentimiento no se guarda nada (Ley 18.331, ver la
 * política de privacidad del local).
 */
export function FormularioContactoRetiro({
  valor,
  onChange,
  error,
  rutaPrivacidad,
  deshabilitado = false,
}: Props) {
  const idNombre = useId();
  const idContacto = useId();
  const idAyuda = useId();
  const idError = useId();
  const descripcion = error ? `${idAyuda} ${idError}` : idAyuda;

  return (
    <fieldset
      className="border-t border-culinary-neutral/15 pt-4 mb-4"
      disabled={deshabilitado}
    >
      <legend className="text-sm font-semibold text-foreground mb-1">
        Tus datos (opcional)
      </legend>
      <p id={idAyuda} className="text-xs text-[#5a575e] mb-3">
        Con tu nombre te reconocemos en el mostrador. El código de retiro te lo
        damos igual al pagar.
      </p>
      <div className="flex flex-col gap-3">
        <div>
          <label
            htmlFor={idNombre}
            className="text-xs font-semibold text-foreground mb-1 block"
          >
            Nombre
          </label>
          <input
            id={idNombre}
            type="text"
            autoComplete="given-name"
            value={valor.nombre}
            maxLength={LARGO_MAXIMO_NOMBRE_RETIRO}
            onChange={(e) => onChange({ ...valor, nombre: e.target.value })}
            aria-describedby={descripcion}
            className={CLASE_CAMPO}
          />
        </div>
        <div>
          <label
            htmlFor={idContacto}
            className="text-xs font-semibold text-foreground mb-1 block"
          >
            Teléfono o correo
          </label>
          <input
            id={idContacto}
            type="text"
            autoComplete="tel"
            value={valor.contacto}
            maxLength={LARGO_MAXIMO_CONTACTO_RETIRO}
            onChange={(e) => onChange({ ...valor, contacto: e.target.value })}
            aria-describedby={descripcion}
            className={CLASE_CAMPO}
          />
        </div>
        <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={valor.consentimiento}
            onChange={(e) =>
              onChange({ ...valor, consentimiento: e.target.checked })
            }
            className="mt-0.5 h-4 w-4 accent-[#6e54ad]"
          />
          <span>
            Acepto que el local guarde mi nombre y contacto para este pedido,
            según su{" "}
            <a
              href={rutaPrivacidad}
              className="underline text-[#6e54ad]"
              target="_blank"
              rel="noopener noreferrer"
            >
              política de privacidad
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            .
          </span>
        </label>
      </div>
      {error && (
        <p id={idError} role="alert" className="mt-2 text-xs text-[#BA1A1A]">
          {error}
        </p>
      )}
    </fieldset>
  );
}
