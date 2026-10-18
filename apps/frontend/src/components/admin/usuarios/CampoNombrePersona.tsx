'use client';

import { LARGO_MAXIMO_NOMBRE } from './Usuarios.utils';

interface Props {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  /** Mensaje junto al campo, o null si está bien. */
  error: string | null;
  /** En el alta los dos son obligatorios (BL-361). */
  requerido?: boolean;
}

const CLASE_INPUT =
  'min-h-12 w-full rounded-lg border px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

/**
 * Campo de nombre o apellido, igual en «Nuevo usuario» y «Editar usuario»
 * (BL-361 y BL-366). El error va debajo, asociado con aria-describedby, y el
 * campo queda marcado con aria-invalid. No usa `required` del navegador: así
 * el mensaje es siempre el nuestro, en español.
 */
export function CampoNombrePersona({
  id,
  etiqueta,
  valor,
  onChange,
  error,
  requerido = false,
}: Readonly<Props>) {
  const idError = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-label-md text-on-surface-variant">
        {etiqueta}
      </label>
      <input
        id={id}
        aria-required={requerido || undefined}
        maxLength={LARGO_MAXIMO_NOMBRE}
        autoComplete="off"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? idError : undefined}
        className={`${CLASE_INPUT} ${error ? 'border-error' : 'border-outline-variant'}`}
      />
      {error && (
        <p id={idError} className="mt-1 text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
