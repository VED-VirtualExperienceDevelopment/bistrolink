"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  claseEstadoDgi,
  ESTADOS_DGI,
  filaComprobante,
  filtrosIniciales,
  rangoInvalido,
  rutaComprobantes,
  type Comprobante,
  type EstadoDgi,
  type FiltrosComprobantes,
  type PaginaComprobantes,
} from "@/components/admin/comprobantes/comprobantes.utils";

const CLASE_CONTROL =
  "min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const CLASE_ETIQUETA = "mb-1 block text-label-md text-on-surface-variant";
const CLASE_CELDA = "px-3 py-3 text-body-md text-on-surface align-top";

/**
 * HU-009 (BL-455): comprobantes fiscales del establecimiento y su estado
 * ante la DGI. Solo Administrador y solo lectura. El PDF no se puede bajar
 * por la API de Surtec (BL-454): el enlace lleva a la consulta de DGI.
 */
export default function ComprobantesPage() {
  const { token, hasRole } = useKeycloakAuth();
  const router = useRouter();

  useEffect(() => {
    if (!hasRole("ADMIN")) router.replace("/admin/mesas");
  }, [hasRole, router]);

  const [filtros, setFiltros] = useState<FiltrosComprobantes>(() =>
    filtrosIniciales(),
  );
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([]);
  const [pagina, setPagina] = useState(1);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(
    async (numero: number) => {
      if (!token || rangoInvalido(filtros)) return;
      setCargando(true);
      setError(null);
      try {
        const datos = await apiFetch<PaginaComprobantes>(
          rutaComprobantes(filtros, numero),
          token,
        );
        setComprobantes((anteriores) =>
          numero === 1
            ? datos.comprobantes
            : [...anteriores, ...datos.comprobantes],
        );
        setPagina(datos.pagina);
        setHayMas(datos.hayMas);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "No se pudieron cargar los comprobantes",
        );
      } finally {
        setCargando(false);
      }
    },
    [token, filtros],
  );

  // Cada cambio de filtros vuelve a la primera página.
  useEffect(() => {
    if (hasRole("ADMIN")) void cargar(1);
  }, [cargar, hasRole]);

  if (!hasRole("ADMIN")) return null;

  const invalido = rangoInvalido(filtros);

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-headline-lg text-primary">Comprobantes</h1>
        <p className="text-body-md text-on-surface-variant">
          e-Tickets y e-Facturas emitidos por tu restaurante y su estado ante la
          DGI. El estado se actualiza solo, cada pocos minutos.
        </p>
      </div>

      <form
        role="search"
        aria-label="Filtrar los comprobantes"
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-4 md:grid-cols-3"
      >
        <div>
          <label htmlFor="comprobantes-desde" className={CLASE_ETIQUETA}>
            Desde
          </label>
          <input
            id="comprobantes-desde"
            type="date"
            value={filtros.desde}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
            className={CLASE_CONTROL}
            aria-invalid={invalido}
            aria-describedby={invalido ? "comprobantes-rango" : undefined}
          />
        </div>
        <div>
          <label htmlFor="comprobantes-hasta" className={CLASE_ETIQUETA}>
            Hasta
          </label>
          <input
            id="comprobantes-hasta"
            type="date"
            value={filtros.hasta}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
            className={CLASE_CONTROL}
            aria-invalid={invalido}
            aria-describedby={invalido ? "comprobantes-rango" : undefined}
          />
        </div>
        <div>
          <label htmlFor="comprobantes-estado" className={CLASE_ETIQUETA}>
            Estado ante la DGI
          </label>
          <select
            id="comprobantes-estado"
            value={filtros.estado}
            onChange={(e) =>
              setFiltros({
                ...filtros,
                estado: e.target.value as "" | EstadoDgi,
              })
            }
            className={CLASE_CONTROL}
          >
            <option value="">Todos</option>
            {ESTADOS_DGI.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.texto}
              </option>
            ))}
          </select>
        </div>
      </form>

      {invalido && (
        <p
          id="comprobantes-rango"
          role="alert"
          className="text-body-md text-error"
        >
          La fecha «Desde» tiene que ser anterior o igual a «Hasta».
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {error}
        </div>
      )}

      {!error && !cargando && comprobantes.length === 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
          <span
            className="material-symbols-outlined text-4xl text-on-surface-variant"
            aria-hidden="true"
          >
            receipt_long
          </span>
          <p className="mt-2 text-body-lg text-on-surface">
            No hay comprobantes con esos filtros
          </p>
        </div>
      )}

      {comprobantes.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">
              Comprobantes emitidos, del más reciente al más antiguo
            </caption>
            <thead className="bg-surface-container-low text-label-md text-on-surface-variant">
              <tr>
                <th scope="col" className="px-3 py-3">
                  Fecha
                </th>
                <th scope="col" className="px-3 py-3">
                  Comprobante
                </th>
                <th scope="col" className="px-3 py-3">
                  Pedido
                </th>
                <th scope="col" className="px-3 py-3 text-right">
                  Monto
                </th>
                <th scope="col" className="px-3 py-3">
                  Estado DGI
                </th>
                <th scope="col" className="px-3 py-3">
                  <span className="sr-only">Consulta en DGI</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {comprobantes.map((c) => {
                const f = filaComprobante(c);
                return (
                  <tr key={c.id} className="border-t border-outline-variant">
                    <td className={CLASE_CELDA}>
                      <time dateTime={c.fechaEmision}>{f.fecha}</time>
                    </td>
                    <td className={CLASE_CELDA}>
                      <span className="font-medium">{f.tipo}</span> {f.numero}
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
                        className={`inline-block rounded-full px-2.5 py-0.5 text-label-md ${claseEstadoDgi(c.estadoDgi)}`}
                      >
                        {f.estado}
                      </span>
                      {c.estadoDgiMotivo && (
                        <span className="mt-1 block text-body-sm text-on-surface-variant">
                          {c.estadoDgiMotivo}
                        </span>
                      )}
                    </td>
                    <td className={CLASE_CELDA}>
                      {f.enlaceDgi && (
                        <a
                          href={f.enlaceDgi}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline"
                        >
                          Ver en DGI
                          <span className="sr-only">
                            {" "}
                            ({f.tipo} {f.numero}, se abre en otra pestaña)
                          </span>
                        </a>
                      )}
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
            Ver más antiguos
          </button>
        </div>
      )}
    </div>
  );
}
