"use client";

import { useCallback, useEffect, useState } from "react";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { QrMesa, QrRestaurante } from "@/types/qr-mesa";
import { descargarPdfQr } from "./generar-pdf-qr";
import { nombreArchivoPdf, tarjetasDeQr } from "./qr-pdf.utils";

interface Props {
  readonly restauranteId: string;
}

/**
 * HU-034 (BL-204): QR de las mesas para el administrador.
 *
 * - Descargar el PDF imprimible con el QR de todas las mesas (y el del link
 *   web del local), o el de una sola mesa.
 * - Regenerar el QR de una mesa (por ejemplo, si se filtró una foto): el QR
 *   impreso anterior deja de funcionar y hay que imprimir el nuevo.
 *
 * Solo ADMIN: el backend (GET /mesas/qr, POST /mesas/:id/qr/regenerar)
 * rechaza a cualquier otro rol, y la página no lo muestra.
 */
export function QrMesasPanel({ restauranteId }: Props) {
  const { token } = useKeycloakAuth();

  const [datos, setDatos] = useState<QrRestaurante | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  const [aRegenerar, setARegenerar] = useState<QrMesa | null>(null);
  const [regenerando, setRegenerando] = useState(false);
  const [errorRegenerar, setErrorRegenerar] = useState<string | null>(null);
  const [regenerada, setRegenerada] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    if (!token) return;
    setCargando(true);
    setError(null);
    try {
      setDatos(
        await apiFetch<QrRestaurante>(
          `/mesas/qr?restauranteId=${restauranteId}`,
          token,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudieron cargar los QR de las mesas",
      );
    } finally {
      setCargando(false);
    }
  }, [token, restauranteId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function descargar(mesa?: QrMesa) {
    if (!datos) return;
    setGenerando(true);
    setError(null);
    try {
      await descargarPdfQr(
        tarjetasDeQr(datos, mesa?.id),
        nombreArchivoPdf(datos.restaurante.nombre, mesa?.numero),
      );
    } catch {
      setError("No se pudo generar el PDF. Probá de nuevo.");
    } finally {
      setGenerando(false);
    }
  }

  async function confirmarRegenerar() {
    if (!token || !aRegenerar) return;
    setRegenerando(true);
    setErrorRegenerar(null);
    try {
      const nueva = await apiFetch<QrMesa>(
        `/mesas/${aRegenerar.id}/qr/regenerar`,
        token,
        { method: "POST" },
      );
      setDatos(
        (prev) =>
          prev && {
            ...prev,
            mesas: prev.mesas.map((m) => (m.id === nueva.id ? nueva : m)),
          },
      );
      setRegenerada(nueva.numero);
      setARegenerar(null);
    } catch (err) {
      setErrorRegenerar(
        err instanceof ApiError ? err.message : "No se pudo regenerar el QR",
      );
    } finally {
      setRegenerando(false);
    }
  }

  function cerrarDialogo() {
    setARegenerar(null);
    setErrorRegenerar(null);
  }

  return (
    <section className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title-lg text-on-surface">QR de las mesas</h2>
          <p className="text-body-sm text-on-surface-variant">
            Imprimí el QR de cada mesa. Si agregaste mesas en el mapa, guardalo
            antes de descargar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => descargar()}
          disabled={!datos || generando || datos.mesas.length === 0}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            className="material-symbols-outlined text-[20px]"
            aria-hidden="true"
          >
            picture_as_pdf
          </span>
          <span>{generando ? "Generando…" : "Descargar PDF de todas"}</span>
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
        >
          {error}
        </p>
      )}

      {regenerada !== null && (
        <output className="block rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-on-surface">
          Se regeneró el QR de la mesa {regenerada}. Descargalo e imprimilo: el
          anterior ya no funciona.
        </output>
      )}

      {cargando && (
        <div className="flex justify-center py-6">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!cargando && datos && datos.mesas.length === 0 && (
        <p className="text-body-md text-on-surface-variant">
          Todavía no hay mesas. Agregalas en el mapa y guardalo.
        </p>
      )}

      {!cargando && datos && datos.mesas.length > 0 && (
        <ul className="divide-y divide-outline-variant">
          {datos.mesas.map((mesa) => (
            <li
              key={mesa.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span className="text-body-md font-medium text-on-surface">
                Mesa {mesa.numero}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => descargar(mesa)}
                  disabled={generando}
                  aria-label={`Descargar el QR de la mesa ${mesa.numero}`}
                  className="rounded-lg border border-outline-variant px-3 py-1.5 text-body-sm text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"
                >
                  Descargar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRegenerada(null);
                    setARegenerar(mesa);
                  }}
                  aria-label={`Regenerar el QR de la mesa ${mesa.numero}`}
                  className="rounded-lg border border-error px-3 py-1.5 text-body-sm text-error hover:bg-error-container"
                >
                  Regenerar QR
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={aRegenerar !== null}
        onClose={cerrarDialogo}
        title="Regenerar QR"
      >
        <div className="space-y-4">
          <p className="text-body-md text-on-surface">
            El QR impreso de la mesa {aRegenerar?.numero} va a dejar de
            funcionar: quien lo escanee verá un aviso para pedir el nuevo.
            Después de regenerarlo, descargá e imprimí el QR nuevo.
          </p>

          {errorRegenerar && (
            <p
              role="alert"
              className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
            >
              {errorRegenerar}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={cerrarDialogo}
              className="rounded-lg px-4 py-2 text-body-md text-on-surface-variant hover:bg-surface-container"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmarRegenerar}
              disabled={regenerando}
              className="rounded-lg bg-error px-4 py-2 text-body-md font-medium text-on-error hover:opacity-90 disabled:opacity-50"
            >
              {regenerando ? "Regenerando…" : "Regenerar"}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
