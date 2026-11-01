"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { Usuario } from "@/types/usuario";
import {
  autorDelRegistro,
  cambiosDelRegistro,
  ETIQUETAS_ACCION,
  etiquetaAccion,
  objetoDelRegistro,
  fechaParaMostrar,
  FILTROS_AUDITORIA_INICIALES,
  hayFiltrosAuditoria,
  rangoInvalido,
  rutaAuditoria,
  type FiltrosAuditoria,
  type PaginaAuditoria,
  type RegistroAuditoria,
} from "@/components/admin/auditoria/auditoria.utils";

const CLASE_CONTROL =
  "min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const CLASE_ETIQUETA = "mb-1 block text-label-md text-on-surface-variant";

const OPCIONES_ACCION = Object.entries(ETIQUETAS_ACCION).sort((a, b) =>
  a[1].localeCompare(b[1], "es"),
);

/**
 * HU-035 (BL-205): registro de auditoría. El administrador ve quién hizo
 * cada acción sensible y cuándo, y lo filtra por fecha, usuario y acción.
 * Solo lectura: no hay forma de modificar ni borrar registros.
 */
export default function AuditoriaPage() {
  const { token, hasRole } = useKeycloakAuth();
  const router = useRouter();

  // Solo ADMIN (mismo criterio que /admin/usuarios): un Mozo que llega por
  // URL directa vuelve al mapa de mesas.
  useEffect(() => {
    if (!hasRole("ADMIN")) router.replace("/admin/mesas");
  }, [hasRole, router]);

  const [filtros, setFiltros] = useState<FiltrosAuditoria>(
    FILTROS_AUDITORIA_INICIALES,
  );
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [pagina, setPagina] = useState(1);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);

  const cargar = useCallback(
    async (numero: number) => {
      if (!token || rangoInvalido(filtros)) return;
      setCargando(true);
      setError(null);
      try {
        const datos = await apiFetch<PaginaAuditoria>(
          rutaAuditoria(filtros, numero),
          token,
        );
        setRegistros((anteriores) =>
          numero === 1 ? datos.registros : [...anteriores, ...datos.registros],
        );
        setPagina(datos.pagina);
        setHayMas(datos.hayMas);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "No se pudo cargar el registro",
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

  // Para el filtro de usuario: los del local (la cuenta de cocina vive solo
  // en Keycloak y no tiene fila propia).
  useEffect(() => {
    if (!token || !hasRole("ADMIN")) return;
    apiFetch<Usuario[]>("/usuarios", token)
      .then((lista) => setUsuarios(lista.filter((u) => !u.cuentaCompartida)))
      .catch(() => setUsuarios([]));
  }, [token, hasRole]);

  if (!hasRole("ADMIN")) return null;

  const invalido = rangoInvalido(filtros);

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-headline-lg text-primary">Auditoría</h1>
        <p className="text-body-md text-on-surface-variant">
          Quién hizo cada acción sensible en tu restaurante y cuándo: cuentas,
          carta, cancelaciones y cobros. Los registros no se pueden modificar ni
          borrar.
        </p>
      </div>

      <form
        role="search"
        aria-label="Filtrar el registro de auditoría"
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-4 md:grid-cols-4"
      >
        <div>
          <label htmlFor="auditoria-desde" className={CLASE_ETIQUETA}>
            Desde
          </label>
          <input
            id="auditoria-desde"
            type="date"
            value={filtros.desde}
            onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
            className={CLASE_CONTROL}
            aria-invalid={invalido}
            aria-describedby={invalido ? "auditoria-rango" : undefined}
          />
        </div>
        <div>
          <label htmlFor="auditoria-hasta" className={CLASE_ETIQUETA}>
            Hasta
          </label>
          <input
            id="auditoria-hasta"
            type="date"
            value={filtros.hasta}
            onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
            className={CLASE_CONTROL}
            aria-invalid={invalido}
            aria-describedby={invalido ? "auditoria-rango" : undefined}
          />
        </div>
        <div>
          <label htmlFor="auditoria-usuario" className={CLASE_ETIQUETA}>
            Usuario
          </label>
          <select
            id="auditoria-usuario"
            value={filtros.usuarioId}
            onChange={(e) =>
              setFiltros({ ...filtros, usuarioId: e.target.value })
            }
            className={CLASE_CONTROL}
          >
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {[u.nombre, u.apellido].filter(Boolean).join(" ") ||
                  u.username ||
                  u.email ||
                  u.id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="auditoria-accion" className={CLASE_ETIQUETA}>
            Acción
          </label>
          <select
            id="auditoria-accion"
            value={filtros.accion}
            onChange={(e) => setFiltros({ ...filtros, accion: e.target.value })}
            className={CLASE_CONTROL}
          >
            <option value="">Todas</option>
            {OPCIONES_ACCION.map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </div>
      </form>

      {invalido && (
        <p
          id="auditoria-rango"
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

      {!error && !cargando && registros.length === 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
          <span
            className="material-symbols-outlined text-4xl text-on-surface-variant"
            aria-hidden="true"
          >
            history
          </span>
          <p className="mt-2 text-body-lg text-on-surface">
            {hayFiltrosAuditoria(filtros)
              ? "No hay acciones con esos filtros"
              : "Todavía no hay acciones registradas"}
          </p>
          {hayFiltrosAuditoria(filtros) && (
            <button
              type="button"
              onClick={() => setFiltros(FILTROS_AUDITORIA_INICIALES)}
              className="mt-4 min-h-12 rounded-lg px-4 text-body-md font-medium text-primary hover:bg-surface-container"
            >
              Quitar los filtros
            </button>
          )}
        </div>
      )}

      {registros.length > 0 && (
        <ol
          className="space-y-3"
          aria-label="Acciones registradas, de la más reciente a la más antigua"
        >
          {registros.map((r) => {
            const cambios = cambiosDelRegistro(r);
            const objeto = objetoDelRegistro(r);
            return (
              <li
                key={r.id}
                className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4"
              >
                <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
                  <p className="text-body-lg font-medium text-on-surface">
                    {etiquetaAccion(r.accion)}
                    {/* BL-396: sobre qué ítem o categoría. */}
                    {objeto && (
                      <span className="font-normal text-on-surface-variant">
                        {" "}
                        {objeto}
                      </span>
                    )}
                  </p>
                  <p className="text-body-md text-on-surface-variant">
                    <time dateTime={r.fecha}>{fechaParaMostrar(r.fecha)}</time>
                  </p>
                </div>
                <p className="text-body-md text-on-surface-variant">
                  Por {autorDelRegistro(r)}
                  {r.ip ? ` · IP ${r.ip}` : ""}
                </p>
                {cambios.length > 0 && (
                  <ul className="mt-2 space-y-1 text-body-md text-on-surface">
                    {cambios.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
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
            Ver más antiguas
          </button>
        </div>
      )}
    </div>
  );
}
