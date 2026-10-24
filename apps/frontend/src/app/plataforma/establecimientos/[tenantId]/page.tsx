"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { FichaEstablecimiento } from "@/components/plataforma/FichaEstablecimiento";
import { EditarEstablecimientoDialog } from "@/components/plataforma/EditarEstablecimientoDialog";
import {
  type AccionEstado,
  CambiarEstadoEstablecimientoDialog,
} from "@/components/plataforma/CambiarEstadoEstablecimientoDialog";
import {
  mensajeErrorFicha,
  rutaFicha,
} from "@/components/plataforma/plataforma.utils";
import type { FichaEstablecimiento as Ficha } from "@/types/plataforma";

/**
 * BL-411: ficha de un establecimiento (/plataforma/establecimientos/[id]).
 * El guard del rol PLATAFORMA está en PlataformaShell (layout de
 * /plataforma), y el backend vuelve a controlar el token.
 *
 * Página de cliente, como el listado: el token está en el navegador. El id
 * se lee con useParams; la API lo valida (400 si no es un UUID, 404 si no
 * existe).
 *
 * BL-412: «Editar datos» abre el diálogo; al guardar, la ficha se reemplaza
 * por la que devuelve el PATCH y se anuncia «Datos guardados».
 *
 * BL-413: «Suspender» o «Reactivar» (según el estado) abren la
 * confirmación; al confirmar, la ficha se reemplaza por la que devuelve la
 * API y se anuncia el resultado en la misma región aria-live.
 */
export default function FichaEstablecimientoPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { token } = useKeycloakAuth();
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  // BL-412: se suma 1 cada vez que se abre, para montar el diálogo de nuevo
  // con los datos actuales.
  const [aperturas, setAperturas] = useState(0);
  const [aviso, setAviso] = useState("");
  // BL-413: acción de estado en curso (null = diálogo cerrado).
  const [accionEstado, setAccionEstado] = useState<AccionEstado | null>(null);

  const cargar = useCallback(async () => {
    if (!token || !tenantId) return;
    setCargando(true);
    setError(null);
    try {
      setFicha(await apiFetch<Ficha>(rutaFicha(tenantId), token));
    } catch (err) {
      setFicha(null);
      setError(
        err instanceof ApiError
          ? mensajeErrorFicha(err.status, err.message)
          : "No se pudo cargar la ficha del establecimiento",
      );
    } finally {
      setCargando(false);
    }
  }, [token, tenantId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <Link
        href="/plataforma"
        className="inline-flex min-h-12 items-center gap-1 rounded-lg px-3 text-body-md font-medium text-primary hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span
          className="material-symbols-outlined text-[20px]"
          aria-hidden="true"
        >
          arrow_back
        </span>
        <span>Establecimientos</span>
      </Link>

      {cargando && (
        <output className="flex justify-center py-12">
          <span
            className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
            aria-hidden="true"
          />
          <span className="sr-only">Cargando la ficha…</span>
        </output>
      )}

      {!cargando && error && (
        <div
          role="alert"
          className="space-y-3 rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={cargar}
            className="min-h-12 rounded-lg px-4 font-medium underline hover:bg-surface-container/40"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* BL-412: resultado de la edición, para el lector de pantalla (y a
          la vista). Siempre en el DOM para que se anuncie. */}
      <p
        aria-live="polite"
        className={
          aviso
            ? "rounded-lg bg-secondary-container px-3 py-2 text-body-md text-on-secondary-container"
            : "sr-only"
        }
      >
        {aviso}
      </p>

      {!cargando && !error && ficha && (
        <>
          <FichaEstablecimiento
            ficha={ficha}
            onEditar={() => {
              setAviso("");
              setAperturas((n) => n + 1);
              setEditando(true);
            }}
            onSuspender={() => {
              setAviso("");
              setAperturas((n) => n + 1);
              setAccionEstado("suspender");
            }}
            onReactivar={() => {
              setAviso("");
              setAperturas((n) => n + 1);
              setAccionEstado("reactivar");
            }}
          />
          <EditarEstablecimientoDialog
            key={aperturas}
            open={editando}
            onClose={() => setEditando(false)}
            token={token}
            ficha={ficha}
            onActualizado={(actualizada) => {
              setFicha(actualizada);
              setAviso("Datos guardados.");
            }}
          />
          {accionEstado && (
            <CambiarEstadoEstablecimientoDialog
              key={`estado-${aperturas}`}
              accion={accionEstado}
              open
              onClose={() => setAccionEstado(null)}
              token={token}
              ficha={ficha}
              onActualizado={(actualizada) => {
                setFicha(actualizada);
                setAviso(
                  accionEstado === "suspender"
                    ? "Establecimiento suspendido."
                    : "Establecimiento reactivado.",
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
