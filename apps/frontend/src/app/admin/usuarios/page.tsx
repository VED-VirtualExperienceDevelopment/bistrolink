'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { apiFetch, ApiError } from '@/lib/api-client';
import { UsuariosTable } from '@/components/admin/usuarios/UsuariosTable';
import { CrearUsuarioDialog } from '@/components/admin/usuarios/CrearUsuarioDialog';
import { EditarUsuarioDialog } from '@/components/admin/usuarios/EditarUsuarioDialog';
import { DesactivarUsuarioDialog } from '@/components/admin/usuarios/DesactivarUsuarioDialog';
import { ReactivarUsuarioDialog } from '@/components/admin/usuarios/ReactivarUsuarioDialog';
import { RestablecerContrasenaDialog } from '@/components/admin/usuarios/RestablecerContrasenaDialog';
import { CerrarSesionesDialog } from '@/components/admin/usuarios/CerrarSesionesDialog';
import { FiltrosUsuarios } from '@/components/admin/usuarios/FiltrosUsuarios';
import {
  FILTROS_INICIALES,
  filtrarUsuarios,
  hayFiltrosActivos,
  textoCantidadUsuarios,
  type FiltrosUsuarios as Filtros,
} from '@/components/admin/usuarios/Usuarios.utils';
import type { Usuario } from '@/types/usuario';

export default function UsuariosPage() {
  const { token, hasRole, keycloakId } = useKeycloakAuth();
  const router = useRouter();

  // BL-160: el layout de /admin/* ahora deja entrar a cualquier staff
  // (ADMIN o MOZO) porque /admin/mesas es de lectura para Mozo. Gestión de
  // usuarios en cambio debe seguir siendo admin-exclusiva, así que esta
  // pantalla agrega su PROPIO guard en vez de depender del layout — mismo
  // criterio que ya usa MapaMesasEditor con `puedeEditar` para las acciones
  // de edición.
  useEffect(() => {
    if (!hasRole('ADMIN')) {
      router.replace('/admin/mesas');
    }
  }, [hasRole, router]);

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // BL-363: búsqueda y filtros (en el navegador).
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES);
  const usuariosFiltrados = useMemo(
    () => filtrarUsuarios(usuarios, filtros),
    [usuarios, filtros],
  );

  // GAP DE INTEGRACIÓN: CreateUsuarioDto exige restauranteId, y un tenant
  // puede tener más de un Restaurante (Anexo 6 §4.2). No existe todavía un
  // endpoint GET /restaurantes en lo que vimos del backend — hay que agregarlo
  // (con su propio filtro por tenantId vía RLS) o, si el MVP asume un único
  // restaurante por tenant, resolver ese ID de otra forma (claim del JWT,
  // por ejemplo). Placeholder abajo para no bloquear el resto de la pantalla.
  const [restauranteId, setRestauranteId] = useState<string | null>(null);

  const [crearOpen, setCrearOpen] = useState(false);
  const [usuarioAEditar, setUsuarioAEditar] = useState<Usuario | null>(null);
  const [usuarioADesactivar, setUsuarioADesactivar] = useState<Usuario | null>(null);
  const [usuarioAReactivar, setUsuarioAReactivar] = useState<Usuario | null>(null);
  const [usuarioARestablecer, setUsuarioARestablecer] = useState<Usuario | null>(null);
  const [usuarioACerrarSesiones, setUsuarioACerrarSesiones] = useState<Usuario | null>(null);

  const cargarUsuarios = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<Usuario[]>('/usuarios', token);
      setUsuarios(data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'No se pudo cargar la lista');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (hasRole('ADMIN')) cargarUsuarios();
  }, [cargarUsuarios, hasRole]);

  useEffect(() => {
    // TODO: reemplazar por GET /restaurantes cuando exista el endpoint.
    if (!token || !hasRole('ADMIN')) return;
    apiFetch<{ id: string }[]>('/restaurantes', token)
      .then((rs) => setRestauranteId(rs[0]?.id ?? null))
      .catch(() => setRestauranteId(null));
  }, [token, hasRole]);

  // Evita el flash de contenido admin-only mientras el useEffect de arriba
  // redirige a un Mozo que haya llegado por URL directa.
  if (!hasRole('ADMIN')) {
    return null;
  }

  return (
    // BL-364: a todo el ancho del área de contenido, sin el tope de
    // max-w-container (mismo criterio que el mapa de mesas, BL-339).
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-headline-lg text-primary">Usuarios</h1>
          <p className="text-body-md text-on-surface-variant">
            Administradores, mozos y la cuenta de la cocina de tu restaurante.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCrearOpen(true)}
          disabled={!restauranteId}
          title={!restauranteId ? 'Falta resolver el restaurante activo' : undefined}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            person_add
          </span>
          <span>Nuevo usuario</span>
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!loading && loadError && (
        <div role="alert" className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
          {loadError}
        </div>
      )}

      {!loading && !loadError && usuarios.length > 0 && (
        <>
          <FiltrosUsuarios filtros={filtros} onChange={setFiltros} />
          {/* BL-363: la cantidad se anuncia al lector de pantalla cuando
              cambia el resultado (aria-live), sin mover el foco. */}
          <p className="text-body-md text-on-surface-variant" aria-live="polite" aria-atomic="true">
            {textoCantidadUsuarios(usuariosFiltrados.length)}
          </p>
        </>
      )}

      {/* BL-363: estado vacío propio cuando los filtros no dejan a nadie
          (distinto del de «todavía no hay usuarios», que muestra la tabla). */}
      {!loading && !loadError && usuarios.length > 0 && usuariosFiltrados.length === 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant" aria-hidden="true">
            search_off
          </span>
          <p className="mt-2 text-body-lg text-on-surface">No hay usuarios con esos filtros</p>
          {hayFiltrosActivos(filtros) ? (
            <button
              type="button"
              onClick={() => setFiltros(FILTROS_INICIALES)}
              className="mt-4 min-h-12 rounded-lg px-4 text-body-md font-medium text-primary hover:bg-surface-container"
            >
              Limpiar filtros
            </button>
          ) : (
            // Con los filtros iniciales solo se ven los activos: si están
            // todos desactivados, se ofrece verlos en vez de «limpiar».
            <button
              type="button"
              onClick={() => setFiltros({ ...FILTROS_INICIALES, estado: 'TODOS' })}
              className="mt-4 min-h-12 rounded-lg px-4 text-body-md font-medium text-primary hover:bg-surface-container"
            >
              Ver también los inactivos
            </button>
          )}
        </div>
      )}

      {!loading && !loadError && (usuarios.length === 0 || usuariosFiltrados.length > 0) && (
        <UsuariosTable
          usuarios={usuariosFiltrados}
          onEditar={setUsuarioAEditar}
          onDesactivar={setUsuarioADesactivar}
          onReactivar={setUsuarioAReactivar}
          onRestablecerContrasena={setUsuarioARestablecer}
          onCerrarSesiones={setUsuarioACerrarSesiones}
          keycloakIdPropio={keycloakId}
        />
      )}

      {restauranteId && (
        <CrearUsuarioDialog
          open={crearOpen}
          onClose={() => setCrearOpen(false)}
          token={token}
          restauranteId={restauranteId}
          onCreated={(nuevo) => setUsuarios((prev) => [...prev, nuevo])}
        />
      )}

      {/* BL-366: key por usuario, para que el formulario tome los datos de
          cada persona al abrirse (antes quedaba el valor de la primera). */}
      <EditarUsuarioDialog
        key={`editar-${usuarioAEditar?.id ?? 'ninguno'}`}
        open={usuarioAEditar !== null}
        onClose={() => setUsuarioAEditar(null)}
        token={token}
        usuario={usuarioAEditar}
        esPropio={usuarioAEditar !== null && usuarioAEditar.keycloakId === keycloakId}
        onUpdated={(actualizado) =>
          setUsuarios((prev) => prev.map((u) => (u.id === actualizado.id ? actualizado : u)))
        }
      />

      <DesactivarUsuarioDialog
        open={usuarioADesactivar !== null}
        onClose={() => setUsuarioADesactivar(null)}
        token={token}
        usuario={usuarioADesactivar}
        onDesactivado={(id) =>
          setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, activo: false } : u)))
        }
      />

      <RestablecerContrasenaDialog
        open={usuarioARestablecer !== null}
        onClose={() => setUsuarioARestablecer(null)}
        token={token}
        usuario={usuarioARestablecer}
      />

      {/* BL-367: key por usuario, así el mensaje de «listo» o de error no
          queda de una persona a otra. Con prefijo propio: las keys de los
          diálogos hermanos no se pueden repetir (con los dos cerrados, las
          dos valían 'ninguno'). */}
      <CerrarSesionesDialog
        key={`cerrar-sesiones-${usuarioACerrarSesiones?.id ?? 'ninguno'}`}
        open={usuarioACerrarSesiones !== null}
        onClose={() => setUsuarioACerrarSesiones(null)}
        token={token}
        usuario={usuarioACerrarSesiones}
      />

      <ReactivarUsuarioDialog
        open={usuarioAReactivar !== null}
        onClose={() => setUsuarioAReactivar(null)}
        token={token}
        usuario={usuarioAReactivar}
        onReactivado={(id) =>
          setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, activo: true } : u)))
        }
      />
    </div>
  );
}
