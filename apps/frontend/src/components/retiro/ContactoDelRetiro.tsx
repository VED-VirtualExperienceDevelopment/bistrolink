"use client";

import { FormularioContactoRetiro } from "./FormularioContactoRetiro";
import type { useRetiroEnCarta } from "./useRetiroEnCarta";

interface Props {
  readonly retiro: ReturnType<typeof useRetiroEnCarta>;
  /** El error del contacto, si el comensal ya intentó pagar. */
  readonly error: string | null;
  /** Se llama cuando el comensal corrige el formulario con un error a la vista. */
  readonly onCorregir: () => void;
  readonly rutaPrivacidad: string;
  readonly deshabilitado: boolean;
}

/**
 * HU-040 (BL-210): «Tus datos (opcional)» del pedido para retirar, dentro del
 * carrito. En un pedido de mesa no muestra nada.
 */
export function ContactoDelRetiro({
  retiro,
  error,
  onCorregir,
  rutaPrivacidad,
  deshabilitado,
}: Props) {
  if (!retiro.esRetiro) return null;
  return (
    <FormularioContactoRetiro
      valor={retiro.formulario}
      onChange={(valor) => {
        retiro.setFormulario(valor);
        if (error) onCorregir();
      }}
      error={error}
      rutaPrivacidad={rutaPrivacidad}
      deshabilitado={deshabilitado}
    />
  );
}
