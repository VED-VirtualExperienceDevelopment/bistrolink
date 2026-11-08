"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import Switch from "@/components/ui/Switch";
import VentasDelPos from "@/components/admin/pos/VentasDelPos";
import {
  claseEstadoPos,
  filaSincronizacion,
  FILTROS_ESTADO_POS,
  mensajeReintentoPos,
  rutaReintentarPos,
  rutaSincronizaciones,
  RUTA_CONFIGURACION_POS,
  sePuedeReintentar,
  textoIntegracion,
  type FiltroEstadoPos,
  type PaginaSincronizacionesPos,
  type ResultadoReintentoPos,
  type SincronizacionPos,
} from "@/components/admin/pos/pos.utils";

const CLASE_CELDA = "px-3 py-3 text-body-md text-on-surface align-top";
const CLASE_CONTROL =
  "min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

/**
 * HU-011 (BL-488): ventas que BistroLink manda al POS del local. El
 * administrador activa la sincronización, ve el estado de cada venta y
 * anulación y reintenta las que fallaron. BL-489: también ve las ventas que
 * se trajeron del POS (VentasDelPos). Solo Administrador.
 */
export default function PosPage() {
  const { token, hasRole } = useKeycloakAuth();
  const router = useRouter();

  useEffect(() => {
    if (!hasRole("ADMIN")) router.replace("/admin/mesas");
  }, [hasRole, router]);

  const [estado, setEstado] = useState<FiltroEstadoPos>("");
  const [datos, setDatos] = useState<PaginaSincronizacionesPos | null>(null);
  const [filas, setFilas] = useState<SincronizacionPos[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [reintentando, setReintentando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(
    async (numero: number) => {
      if (!token) return;
      setCargando(true);
      setError(null);
      try {
        const pagina = await apiFetch<PaginaSincronizacionesPos>(
          rutaSincronizaciones(estado, numero),
          token,
        );
        setDatos(pagina);
        setFilas((anteriores) =>
          numero === 1
            ? pagina.sincronizaciones
            : [...anteriores, ...pagina.sincronizaciones],
        );
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "No se pudieron cargar las ventas del POS",
        );
      } finally {
        setCargando(false);
      }
    },
    [token, estado],
  );

  useEffect(() => {
    if (hasRole("ADMIN")) void cargar(1);
  }, [cargar, hasRole]);

  async function cambiarHabilitada(habilitada: boolean) {
    if (!token) return;
    setGuardando(true);
    setAviso("");
    try {
      const r = await apiFetch<{ habilitada: boolean }>(
        RUTA_CONFIGURACION_POS,
        token,
        { method: "PATCH", body: JSON.stringify({ habilitada }) },
      );
      setDatos((anterior) =>
        anterior ? { ...anterior, habilitada: r.habilitada } : anterior,
      );
      setAviso(
        r.habilitada
          ? "Envío al POS activado."
          : "Envío al POS desactivado. Lo que estaba pendiente se sigue mandando.",
      );
    } catch (err) {
      setAviso(
        err instanceof ApiError
          ? err.message
          : "No se pudo guardar. Probá de nuevo.",
      );
    } finally {
      setGuardando(false);
    }
  }

  async function reintentar(id: string) {
    if (!token) return;
    setReintentando(id);
    setAviso("");
    try {
      const r = await apiFetch<ResultadoReintentoPos>(
        rutaReintentarPos(id),
        token,
        { method: "POST" },
      );
      setAviso(mensajeReintentoPos(r));
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

  if (!hasRole("ADMIN")) return null;

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-headline-lg text-primary">POS del local</h1>
        <p className="text-body-md text-on-surface-variant">
          Las ventas que cobra BistroLink se mandan al POS del local, para que
          las tengas también en tu sistema. Si un pedido se cancela, la venta se
          anula en el POS. Y las ventas hechas directamente en el POS se traen
          al dashboard de Reportes.
        </p>
      </div>

      {datos && (
        <section
          aria-labelledby="pos-envio"
          className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4"
        >
          <div className="min-w-0">
            <h2 id="pos-envio" className="text-title-md text-on-surface">
              Mandar las ventas al POS
            </h2>
            <p
              id="pos-envio-descripcion"
              className="text-body-md text-on-surface-variant"
            >
              {textoIntegracion(datos)}
            </p>
          </div>
          <Switch
            checked={datos.habilitada}
            onChange={(valor) => void cambiarHabilitada(valor)}
            label="Mandar las ventas al POS"
            describedBy="pos-envio-descripcion"
            disabled={guardando || datos.adaptador === null}
          />
        </section>
      )}

      {datos && token && (
        <VentasDelPos
          token={token}
          habilitada={datos.habilitada}
          adaptador={datos.adaptador}
        />
      )}

      <p
        className="text-body-md text-on-surface"
        aria-live="polite"
        aria-atomic="true"
      >
        {aviso}
      </p>

      <form
        role="search"
        aria-label="Filtrar las ventas del POS"
        onSubmit={(e) => e.preventDefault()}
        className="max-w-xs"
      >
        <label
          htmlFor="pos-estado"
          className="mb-1 block text-label-md text-on-surface-variant"
        >
          Estado
        </label>
        <select
          id="pos-estado"
          value={estado}
          onChange={(e) => setEstado(e.target.value as FiltroEstadoPos)}
          className={CLASE_CONTROL}
        >
          {FILTROS_ESTADO_POS.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.texto}
            </option>
          ))}
        </select>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {error}
        </div>
      )}

      {!error && !cargando && filas.length === 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
          <span
            className="material-symbols-outlined text-4xl text-on-surface-variant"
            aria-hidden="true"
          >
            point_of_sale
          </span>
          <p className="mt-2 text-body-lg text-on-surface">
            No hay ventas para mostrar
          </p>
        </div>
      )}

      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">
              Ventas y anulaciones mandadas al POS, de la más reciente a la más
              antigua
            </caption>
            <thead className="bg-surface-container-low text-label-md text-on-surface-variant">
              <tr>
                <th scope="col" className="px-3 py-3">
                  Fecha
                </th>
                <th scope="col" className="px-3 py-3">
                  Pedido
                </th>
                <th scope="col" className="px-3 py-3 text-right">
                  Total
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
              {filas.map((s) => {
                const f = filaSincronizacion(s);
                return (
                  <tr key={s.id} className="border-t border-outline-variant">
                    <td className={CLASE_CELDA}>
                      {f.fecha}
                      <span className="block text-body-sm text-on-surface-variant">
                        {f.tipo}
                      </span>
                    </td>
                    <td className={CLASE_CELDA}>
                      {f.pedido}
                      <span className="block text-body-sm text-on-surface-variant">
                        {f.origen}
                      </span>
                    </td>
                    <td className={`${CLASE_CELDA} text-right`}>{f.total}</td>
                    <td className={CLASE_CELDA}>
                      <span className={claseEstadoPos(s.estado)}>
                        {f.estado}
                      </span>
                      {f.detalle && (
                        <span className="mt-1 block text-body-sm text-on-surface-variant">
                          {f.detalle}
                        </span>
                      )}
                    </td>
                    <td className={CLASE_CELDA}>
                      {sePuedeReintentar(s) && (
                        <button
                          type="button"
                          onClick={() => void reintentar(s.id)}
                          disabled={reintentando !== null}
                          aria-busy={reintentando === s.id}
                          className="min-h-12 whitespace-nowrap rounded-lg border border-outline-variant px-4 text-body-md font-medium text-primary hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {reintentando === s.id
                            ? "Reintentando…"
                            : "Reintentar"}
                          <span className="sr-only"> (pedido {f.pedido})</span>
                        </button>
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

      {!cargando && datos?.hayMas && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void cargar(datos.pagina + 1)}
            className="min-h-12 rounded-lg border border-outline-variant px-6 text-body-md font-medium text-primary hover:bg-surface-container"
          >
            Ver más
          </button>
        </div>
      )}
    </div>
  );
}
