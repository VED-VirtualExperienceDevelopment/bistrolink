"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api-client";
import type { OrigenMenu } from "@/components/menu-digital.utils";
import {
  avisoRetiroCerrado,
  CODIGO_RETIRO_NO_DISPONIBLE,
  CONTACTO_RETIRO_VACIO,
  contactoParaEnviar,
  errorContactoRetiro,
  firmaContactoRetiro,
  type ContactoRetiro,
  type FormularioContactoRetiro,
  type RetiroPublico,
} from "./retiro.utils";

/**
 * HU-040 (BL-210): lo del pedido para retirar en la carta (MenuDigital).
 * En la mesa no hace nada: sin aviso, sin formulario y sin contacto.
 */
export function useRetiroEnCarta(
  origen: OrigenMenu,
  retiro: RetiroPublico | null | undefined,
) {
  const esRetiro = origen.tipo === "publico";
  const [formulario, setFormulario] = useState<FormularioContactoRetiro>(
    CONTACTO_RETIRO_VACIO,
  );
  // Si el local cerró mientras se armaba el pedido (409 de POST /pedidos).
  const [cerradoAhora, setCerradoAhora] = useState<string | null>(null);

  if (!esRetiro) {
    return {
      esRetiro,
      avisoCerrado: null,
      formulario,
      setFormulario,
      errorContacto: null,
      contactoYFirma: () => ({ contacto: undefined, firma: "" }),
      registrarError: () => undefined,
    };
  }

  return {
    esRetiro,
    /** Por qué no se puede pedir ahora, o null. */
    avisoCerrado: cerradoAhora ?? avisoRetiroCerrado(retiro),
    formulario,
    setFormulario,
    /** Error del formulario de contacto, o null. */
    errorContacto: errorContactoRetiro(formulario),
    /** Lo que va en POST /pedidos y su parte de la firma del carrito. */
    contactoYFirma: (): { contacto?: ContactoRetiro; firma: string } => {
      const contacto = contactoParaEnviar(formulario);
      return { contacto, firma: firmaContactoRetiro(contacto) };
    },
    /** Si el error es que el local dejó de tomar pedidos, lo recuerda. */
    registrarError: (err: unknown, mensaje: string) => {
      if (
        err instanceof ApiError &&
        err.codigo === CODIGO_RETIRO_NO_DISPONIBLE
      ) {
        setCerradoAhora(mensaje);
      }
    },
  };
}
