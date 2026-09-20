'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { apiFetch, ApiError } from '@/lib/api-client';
import { UsuariosTable } from '@/components/admin/usuarios/UsuariosTable';
import { CrearUsuarioDialog } from '@/components/admin/usuarios/CrearUsuarioDialog';
import { EditarRolDialog } from '@/components/admin/usuarios/EditarRolDialog';
import { DesactivarUsuarioDialog } from '@/components/admin/usuarios/DesactivarUsuarioDialog';
import type { Usuario } from '@/types/usuario';

export default function UsuariosPage() {
  const { token, hasRole } = useKeycloakAuth();
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
    <div className="mx-auto max-w-container space-y-6 p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-headline-lg text-primary">Usuarios</h1>
          <p className="text-body-md text-on-surface-variant">
            Administradores y mozos con acceso a tu restaurante.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCrearOpen(true)}
          disabled={!restauranteId}
          title={!restauranteId ? 'Falta resolver el restaurante activo' : undefined}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[20px]">person_add</span>
          Nuevo usuario
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

      {!loading && !loadError && (
        <UsuariosTable
          usuarios={usuarios}
          onEditarRol={setUsuarioAEditar}
          onDesactivar={setUsuarioADesactivar}
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

      <EditarRolDialog
        open={usuarioAEditar !== null}
        onClose={() => setUsuarioAEditar(null)}
        token={token}
        usuario={usuarioAEditar}
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
    </div>
  );
}