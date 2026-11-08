"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  filaPendiente,
  mensajeReintento,
  rutaPendientes,
  rutaReintentar,
  type PaginaPendientesEmision,
  type PendienteEmision,
  type ResultadoReintento,
} from "./comprobantes.utils";

const CLASE_CELDA = "px-3 py-3 text-body-md text-on-surface align-top";

/**
 * HU-023 (BL-96): pagos aprobados sin comprobante fiscal. El sistema los
 * reintenta solo, cada vez más espaciado; los que pasaron el límite quedan
 * «Requiere atención». El administrador puede reintentar cualquiera.
 */
export default function PendientesEmision({
  token,
  onTotal,
}: {
  readonly token: string;
  /** Avisa el total, para el contador de la pestaña. */
  readonly onTotal: (total: number) => void;
}) {
  const [pendientes, setPendientes] = useState<PendienteEmision[]>([]);
  const [pagina, setPagina] = useState(1);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reintentando, setReintentando] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(
    async (numero: number) => {
      setCargando(true);
      setError(null);
      try {
        const datos = await apiFetch<PaginaPendientesEmision>(
          rutaPendientes(numero),
          token,
        );
        setPendientes((anteriores) =>
          numero === 1
            ? datos.pendientes
            : [...anteriores, ...datos.pendientes],
        );
        setPagina(datos.pagina);
        setHayMas(datos.hayMas);
        onTotal(datos.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "No se pudieron cargar los pendientes",
        );
      } finally {
        setCargando(false);
      }
    },
    [token, onTotal],
  );

  useEffect(() => {
    void cargar(1);
  }, [cargar]);

  async function reintentar(pagoId: string) {
    setReintentando(pagoId);
    setAviso("");
    try {
      const r = await apiFetch<ResultadoReintento>(
        rutaReintentar(pagoId),
        token,
        { method: "POST" },
      );
      setAviso(mensajeReintento(r));
      await cargar(1);
    } catch (err) {
      setAviso(
        err instanceof ApiError
          ? err.message
          : "No se pudo reintentar. Probá de nuevo.",
      );
    } finally {
      setReintentando(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-body-md text-on-surface-variant">
        Pagos cobrados que todavía no tienen comprobante fiscal, por ejemplo
        porque el proveedor de facturación no respondió. El sistema los
        reintenta solo; los que superan los intentos o los días quedan «Requiere
        atención».
      </p>

      <p
        className="text-body-md text-on-surface"
        aria-live="polite"
        aria-atomic="true"
      >
        {aviso}
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {error}
        </div>
      )}

      {!error && !cargando && pendientes.length === 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
          <span
            className="material-symbols-outlined text-4xl text-on-surface-variant"
            aria-hidden="true"
          >
            task_alt
          </span>
          <p className="mt-2 text-body-lg text-on-surface">
            No hay pagos sin comprobante
          </p>
        </div>
      )}

      {pendientes.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">
              Pagos sin comprobante, del más antiguo al más reciente
            </caption>
            <thead className="bg-surface-container-low text-label-md text-on-surface-variant">
              <tr>
                <th scope="col" className="px-3 py-3">
                  Pago
                </th>
                <th scope="col" className="px-3 py-3">
                  Pedido
                </th>
                <th scope="col" className="px-3 py-3 text-right">
                  Monto
                </th>
                <th scope="col" className="px-3 py-3">
                  Estado
                </th>
                <th scope="col" className="px-3 py-3">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pendientes.map((p) => {
                const f = filaPendiente(p);
                return (
                  <tr
                    key={p.pagoId}
                    className="border-t border-outline-variant"
                  >
                    <td className={CLASE_CELDA}>
                      <time dateTime={p.fecha}>{f.fecha}</time>
                      <span className="block text-body-sm text-on-surface-variant">
                        {f.medio}
                      </span>
                    </td>
                    <td className={CLASE_CELDA}>
                      {f.pedido}
                      <span className="block text-body-sm text-on-surface-variant">
                        {f.origen}
                      </span>
                    </td>
                    <td className={`${CLASE_CELDA} text-right`}>{f.monto}</td>
                    <td className={CLASE_CELDA}>
                      <span
                        className={
                          p.requiereAtencion
                            ? "inline-block rounded-full bg-error-container px-2.5 py-0.5 text-label-md font-semibold text-on-error-container"
                            : "inline-block rounded-full bg-surface-container-high px-2.5 py-0.5 text-label-md text-on-surface-variant"
                        }
                      >
                        {f.estado}
                      </span>
                      {p.intentos > 0 && (
                        <span className="mt-1 block text-body-sm text-on-surface-variant">
                          {f.intentos}
                          {p.ultimoError ? `: ${p.ultimoError}` : ""}
                        </span>
                      )}
                    </td>
                    <td className={CLASE_CELDA}>
                      <button
                        type="button"
                        onClick={() => void reintentar(p.pagoId)}
                        disabled={reintentando !== null}
                        aria-busy={reintentando === p.pagoId}
                        className="min-h-12 whitespace-nowrap rounded-lg border border-outline-variant px-4 text-body-md font-medium text-primary hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {reintentando === p.pagoId
                          ? "Reintentando…"
                          : "Reintentar ahora"}
                        <span className="sr-only"> (pedido {f.pedido})</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cargando && (
        <div className="flex justify-center py-6" aria-live="polite">
          <span className="sr-only">Cargando…</span>
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!cargando && hayMas && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void cargar(pagina + 1)}
            className="min-h-12 rounded-lg border border-outline-variant px-6 text-body-md font-medium text-primary hover:bg-surface-container"
          >
            Ver más
          </button>
        </div>
      )}
    </div>
  );
}
