"use client";

import { useCallback, useEffect, useState } from "react";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { EstablecimientosTable } from "@/components/plataforma/EstablecimientosTable";
import { AltaEstablecimientoDialog } from "@/components/plataforma/AltaEstablecimientoDialog";
import {
  mensajeDeError,
  resumirPagina,
  totalPaginas,
} from "@/components/plataforma/plataforma.utils";
import type { PaginaEstablecimientos } from "@/types/plataforma";

// BL-405: botones de 48 px (como Usuarios, BL-364, y el mapa, BL-335).
const CLASE_BOTON_PAGINA =
  "flex min-h-12 items-center gap-1 rounded-lg px-3 text-body-md hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40";

/**
 * BL-163 (HU-027): listado de establecimientos y alta de uno nuevo, para el
 * rol PLATAFORMA (el guard está en PlataformaShell).
 *
 * BL-405: a todo el ancho (como Usuarios y el mapa de mesas, BL-339),
 * botones de 48 px, carga anunciada al lector de pantalla y paginación con
 * la página actual marcada y anunciada al cambiar.
 */
export default function PlataformaPage() {
  const { token } = useKeycloakAuth();
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<PaginaEstablecimientos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [altaAbierta, setAltaAbierta] = useState(false);

  const cargar = useCallback(async () => {
    if (!token) return;
    setCargando(true);
    setErrorCarga(null);
    try {
      setDatos(
        await apiFetch<PaginaEstablecimientos>(
          `/plataforma/establecimientos?pagina=${pagina}`,
          token,
        ),
      );
    } catch (err) {
      setErrorCarga(
        err instanceof ApiError
          ? mensajeDeError(err.status, err.message)
          : "No se pudo cargar el listado",
      );
    } finally {
      setCargando(false);
    }
  }, [token, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const paginas = datos ? totalPaginas(datos.total, datos.tamanoPagina) : 1;

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-headline-lg text-primary">Establecimientos</h1>
          <p className="text-body-md text-on-surface-variant">
            Restaurantes dados de alta en BistroLink y quién hizo cada alta.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAltaAbierta(true)}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90"
        >
          <span
            className="material-symbols-outlined text-[20px]"
            aria-hidden="true"
          >
            add_business
          </span>
          <span>Nuevo establecimiento</span>
        </button>
      </div>

      {/* BL-405: resultado de cada carga, para el lector de pantalla. Está
          siempre en el DOM (una región aria-live que aparece junto con su
          texto no siempre se anuncia). */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {!cargando && !errorCarga && datos ? resumirPagina(datos, pagina) : ""}
      </p>

      {cargando && (
        <div role="status" className="flex justify-center py-12">
          <span
            className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
            aria-hidden="true"
          />
          <span className="sr-only">Cargando establecimientos…</span>
        </div>
      )}

      {!cargando && errorCarga && (
        <div
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {errorCarga}
        </div>
      )}

      {!cargando && !errorCarga && datos && (
        <>
          <EstablecimientosTable establecimientos={datos.items} />

          {datos.total > 0 && (
            <nav
              aria-label="Páginas de establecimientos"
              className="flex flex-col gap-2 text-body-md text-on-surface-variant sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                {datos.total}{" "}
                {datos.total === 1 ? "establecimiento" : "establecimientos"}
              </span>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => setPagina((p) => p - 1)}
                  disabled={pagina <= 1}
                  aria-label="Página anterior"
                  className={CLASE_BOTON_PAGINA}
                >
                  <span
                    className="material-symbols-outlined text-[20px]"
                    aria-hidden="true"
                  >
                    chevron_left
                  </span>
                  <span aria-hidden="true">Anterior</span>
                </button>
                <span aria-current="page">
                  Página {pagina} de {paginas}
                </span>
                <button
                  type="button"
                  onClick={() => setPagina((p) => p + 1)}
                  disabled={pagina >= paginas}
                  aria-label="Página siguiente"
                  className={CLASE_BOTON_PAGINA}
                >
                  <span aria-hidden="true">Siguiente</span>
                  <span
                    className="material-symbols-outlined text-[20px]"
                    aria-hidden="true"
                  >
                    chevron_right
                  </span>
                </button>
              </div>
            </nav>
          )}
        </>
      )}

      <AltaEstablecimientoDialog
        open={altaAbierta}
        onClose={() => setAltaAbierta(false)}
        token={token}
        onCreado={() => {
          // El alta nueva aparece primera: volver a la página 1 y recargar.
          if (pagina === 1) cargar();
          else setPagina(1);
        }}
      />
    </div>
  );
}
