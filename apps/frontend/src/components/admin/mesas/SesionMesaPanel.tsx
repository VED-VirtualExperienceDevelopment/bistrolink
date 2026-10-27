"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { EstadoMesa } from "@/types/mesa";
import { ETIQUETA_POR_ESTADO } from "./mapa-mesas.utils";
import {
  mensajeMesaCerrada,
  opcionSesion,
  rutaAccionSesion,
} from "./sesion-mesa.utils";

interface Props {
  /** Undefined si la mesa es nueva y todavía no se guardó el mapa. */
  readonly mesaId?: string;
  readonly numero: number;
  readonly estado: EstadoMesa;
  readonly token: string | undefined;
  /** Para pintar el estado nuevo sin esperar el evento del WebSocket. */
  readonly onEstado: (mesaId: string, estado: EstadoMesa) => void;
}

interface RespuestaMesa {
  id: string;
  estado: EstadoMesa;
}

/**
 * HU-017 (BL-60): abrir, cerrar y marcar limpia la mesa seleccionada en el
 * mapa. Lo ven el mozo y el administrador. El cambio llega igual por
 * WebSocket (mesa:estado_actualizado) a los demás mapas abiertos.
 */
export function SesionMesaPanel({
  mesaId,
  numero,
  estado,
  token,
  onEstado,
}: Props) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const opcion = opcionSesion(estado);

  // Al elegir otra mesa, no queda el aviso de la anterior.
  useEffect(() => {
    setError(null);
    setAviso(null);
  }, [mesaId]);

  async function ejecutar() {
    if (!mesaId || !opcion.accion || enviando) return;
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      const respuesta = await apiFetch<
        RespuestaMesa | { mesa: RespuestaMesa; pedidosCancelados: number }
      >(rutaAccionSesion(mesaId, opcion.accion), token, { method: "POST" });

      if ("mesa" in respuesta) {
        onEstado(respuesta.mesa.id, respuesta.mesa.estado);
        setAviso(mensajeMesaCerrada(numero, respuesta.pedidosCancelados));
      } else {
        onEstado(respuesta.id, respuesta.estado);
      }
    } catch (e) {
      // 409: el backend ya redacta el motivo («Hay 2 pedidos sin entregar…»).
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudo actualizar la mesa. Probá de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section
      aria-label={`Sesión de la mesa ${numero}`}
      className="flex min-h-[3.75rem] flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface-container-low px-4 py-2"
    >
      <p className="text-label-md text-on-surface">
        Mesa {numero} · {ETIQUETA_POR_ESTADO[estado]}
      </p>

      {mesaId ? (
        <>
          <button
            type="button"
            onClick={ejecutar}
            disabled={!opcion.accion || enviando}
            aria-busy={enviando}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-body-md text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-12 touch:px-5"
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[20px]"
            >
              {opcion.icono}
            </span>
            <span>{enviando ? "Guardando…" : opcion.etiqueta}</span>
          </button>
          <p className="text-label-sm text-on-surface-variant">
            {opcion.ayuda}
          </p>
        </>
      ) : (
        <p className="text-label-sm text-on-surface-variant">
          Guardá el mapa para poder abrir esta mesa.
        </p>
      )}

      {error && (
        <p role="alert" className="w-full text-label-sm text-error">
          {error}
        </p>
      )}
      {aviso && (
        // <output> ya tiene el rol «status» (región en vivo): el lector de
        // pantalla anuncia el aviso sin role explícito (Sonar S6819).
        <output className="block w-full text-label-sm text-on-surface">
          {aviso}
        </output>
      )}
    </section>
  );
}
