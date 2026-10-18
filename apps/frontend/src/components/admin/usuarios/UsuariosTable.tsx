'use client';

import type { Usuario } from '@/types/usuario';
import {
  esCuentaCocina,
  esUsuarioPropio,
  nombreCompleto,
  nombreParaMostrar,
  puedeEliminarse,
  textoUltimoIngreso,
} from './Usuarios.utils';

interface Props {
  usuarios: Usuario[];
  onEditar: (usuario: Usuario) => void;
  onDesactivar: (usuario: Usuario) => void;
  onReactivar: (usuario: Usuario) => void;
  onRestablecerContrasena: (usuario: Usuario) => void;
  onCerrarSesiones: (usuario: Usuario) => void;
  onEliminar: (usuario: Usuario) => void;
  /** BL-369: keycloakId de quien está usando la pantalla (sub del token). */
  keycloakIdPropio?: string;
}

const ROL_LABEL: Record<Usuario['rol'], string> = {
  ADMIN: 'Administrador',
  MOZO: 'Mozo',
  COCINA: 'Cocina', // BL-362
};

const ROL_ICONO: Record<Usuario['rol'], string> = {
  ADMIN: 'shield_person',
  MOZO: 'person',
  COCINA: 'soup_kitchen',
};

const ROL_CLASES: Record<Usuario['rol'], string> = {
  ADMIN: 'bg-tertiary-fixed text-on-tertiary-container',
  MOZO: 'bg-secondary-container text-on-secondary-container',
  COCINA: 'bg-primary-fixed text-on-primary-fixed',
};

// BL-364: botones de acción de 48 px. Con el dedo, 8 px entre uno y otro
// (gap-2 en el contenedor).
const CLASE_ACCION =
  'flex h-12 w-12 flex-none items-center justify-center rounded-full text-on-surface-variant transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

// BL-364: en PC y tablet, columnas alineadas (persona, rol, estado,
// acciones); en el celular, cada usuario es una tarjeta (una sola columna).
// Cada fila es su propia grilla, así que todas las columnas tienen ancho fijo
// salvo la de la persona: con "auto", una fila con menos acciones (la cocina
// no tiene «Editar») corría el rol y el estado. BL-382: 17rem = 5 botones
// de 48 px + 4 espacios de 8 px (con «Eliminar», en usuarios sin historial).
const COLUMNAS =
  'md:grid md:grid-cols-[minmax(0,1fr)_10rem_9rem_17rem] md:items-center md:gap-4';

/**
 * Listado de usuarios. BL-364: cada acción tiene un nombre que dice a quién
 * se aplica («Desactivar a Juan Pérez»), los textos miden 14–16 px y el
 * estado se muestra con texto e ícono, no solo con color.
 */
export function UsuariosTable({
  usuarios,
  onEditar,
  onDesactivar,
  onReactivar,
  onRestablecerContrasena,
  onCerrarSesiones,
  onEliminar,
  keycloakIdPropio,
}: Readonly<Props>) {
  if (usuarios.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant" aria-hidden="true">
          group
        </span>
        <p className="mt-2 text-body-lg text-on-surface">Todavía no hay usuarios en este restaurante</p>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Usá &ldquo;Nuevo usuario&rdquo; para dar de alta al primer Mozo o Administrador.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
      {/* Encabezado de columnas, solo en PC y tablet. Es decorativo: cada
          dato de la fila ya se entiende solo (el rol y el estado son texto). */}
      <div
        aria-hidden="true"
        className={`hidden border-b border-outline-variant px-6 py-3 text-body-md font-semibold text-on-surface-variant ${COLUMNAS}`}
      >
        <span>Persona</span>
        <span>Rol</span>
        <span>Estado</span>
        <span className="text-right">Acciones</span>
      </div>

      <ul aria-label="Usuarios" className="divide-y divide-outline-variant">
        {usuarios.map((usuario) => {
          const nombre = nombreParaMostrar(usuario);
          const cocina = esCuentaCocina(usuario);
          const ingreso = textoUltimoIngreso(usuario.ultimoIngreso);
          const propio = esUsuarioPropio(usuario, keycloakIdPropio);
          return (
            <li
              key={usuario.id}
              className={`flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-surface-container-low md:px-6 ${COLUMNAS}`}
            >
              {/* Persona */}
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-surface-container">
                  <span className="material-symbols-outlined text-primary" aria-hidden="true">
                    {ROL_ICONO[usuario.rol]}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="break-words text-body-lg font-semibold text-on-surface">
                    {nombre}
                    {/* BL-369: la fila propia se distingue con texto. */}
                    {propio && <span className="font-normal text-on-surface-variant"> (vos)</span>}
                  </p>
                  {/* BL-362: una sola cuenta para toda la cocina. */}
                  {cocina && (
                    <p className="text-body-md text-on-surface-variant">Cuenta compartida</p>
                  )}
                  {/* BL-361: con nombre cargado, el usuario va debajo (es con lo
                      que la persona ingresa). Sin nombre, ya está arriba. */}
                  {nombreCompleto(usuario) && usuario.username && (
                    <p className="break-all text-body-md text-on-surface-variant">
                      Usuario: {usuario.username}
                    </p>
                  )}
                  {usuario.email && (
                    <p className="break-all text-body-md text-on-surface-variant">{usuario.email}</p>
                  )}
                  {/* BL-368: el relativo se ve; la fecha completa va en el
                      title (al pasar el mouse) y para el lector de pantalla. */}
                  {ingreso && (
                    <p className="text-body-md text-on-surface-variant" title={ingreso.completo}>
                      {ingreso.completo ? (
                        <time dateTime={usuario.ultimoIngreso ?? undefined}>{ingreso.texto}</time>
                      ) : (
                        ingreso.texto
                      )}
                      {ingreso.completo && <span className="sr-only"> ({ingreso.completo})</span>}
                    </p>
                  )}
                </div>
              </div>

              {/* Rol y estado: en el celular, en una fila; en PC, cada uno en su columna. */}
              <div className="flex flex-wrap items-center gap-3 md:contents">
                <span>
                  <span className={`inline-flex rounded-full px-3 py-1 text-body-md ${ROL_CLASES[usuario.rol]}`}>
                    {ROL_LABEL[usuario.rol]}
                  </span>
                </span>

                {/* Estado con texto e ícono: no depende solo del color. */}
                <span
                  className={`inline-flex items-center gap-1.5 text-body-md ${
                    usuario.activo ? 'text-on-surface' : 'text-error'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                    {usuario.activo ? 'check_circle' : 'block'}
                  </span>
                  {usuario.activo ? 'Activo' : 'Desactivado'}
                </span>
              </div>

              {/* Acciones: botones de 48 px con el nombre de la persona. */}
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {/* BL-362 y BL-366: la cuenta de cocina no se edita (ni el rol
                    ni los datos). */}
                {!cocina && (
                  <button
                    type="button"
                    onClick={() => onEditar(usuario)}
                    aria-label={`Editar a ${nombre}`}
                    title="Editar usuario"
                    className={`${CLASE_ACCION} hover:bg-surface-container-high hover:text-primary`}
                  >
                    <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
                      edit
                    </span>
                  </button>
                )}
                {/* BL-359: solo para usuarios activos (uno desactivado no podría ingresar). */}
                {usuario.activo && (
                  <button
                    type="button"
                    onClick={() => onRestablecerContrasena(usuario)}
                    aria-label={`Restablecer la contraseña de ${nombre}`}
                    title="Restablecer contraseña"
                    className={`${CLASE_ACCION} hover:bg-surface-container-high hover:text-primary`}
                  >
                    <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
                      lock_reset
                    </span>
                  </button>
                )}
                {/* BL-367: solo para usuarios activos (uno desactivado ya no
                    tiene sesiones: desactivar las cierra). Incluye la cocina. */}
                {usuario.activo && propio && (
                  <AccionNoDisponible
                    icono="logout"
                    motivo="No podés cerrar tus propias sesiones desde acá. Usá «Cerrar sesión»."
                  />
                )}
                {usuario.activo && !propio && (
                  <button
                    type="button"
                    onClick={() => onCerrarSesiones(usuario)}
                    aria-label={`Cerrar las sesiones de ${nombre}`}
                    title="Cerrar sesiones"
                    className={`${CLASE_ACCION} hover:bg-surface-container-high hover:text-primary`}
                  >
                    <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
                      logout
                    </span>
                  </button>
                )}
                {usuario.activo && propio && (
                  <AccionNoDisponible
                    icono="person_off"
                    motivo="No podés desactivar tu propio usuario. Pedíselo a otro Administrador."
                  />
                )}
                {usuario.activo && !propio && (
                  <button
                    type="button"
                    onClick={() => onDesactivar(usuario)}
                    aria-label={`Desactivar a ${nombre}`}
                    title="Desactivar"
                    className={`${CLASE_ACCION} hover:bg-error-container hover:text-error`}
                  >
                    <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
                      person_off
                    </span>
                  </button>
                )}
                {!usuario.activo && (
                  // BL-358: un usuario desactivado ya no se queda sin acciones.
                  <button
                    type="button"
                    onClick={() => onReactivar(usuario)}
                    aria-label={`Reactivar a ${nombre}`}
                    title="Reactivar"
                    className={`${CLASE_ACCION} hover:bg-surface-container-high hover:text-primary`}
                  >
                    <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
                      how_to_reg
                    </span>
                  </button>
                )}
                {/* BL-382: solo sin historial (creado por error). A los
                    demás se los desactiva. */}
                {puedeEliminarse(usuario, keycloakIdPropio) && (
                  <button
                    type="button"
                    onClick={() => onEliminar(usuario)}
                    aria-label={`Eliminar a ${nombre}`}
                    title="Eliminar"
                    className={`${CLASE_ACCION} hover:bg-error-container hover:text-error`}
                  >
                    <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
                      delete
                    </span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * BL-369: acción que no se puede hacer sobre el propio usuario. Se deja en su
 * lugar (la fila no cambia de forma) y con foco, para que el motivo llegue
 * también por teclado y con lector de pantalla: un botón `disabled` no
 * recibe foco y su explicación no se escucharía. aria-disabled lo anuncia
 * como «no disponible» y el clic no hace nada.
 */
function AccionNoDisponible({ icono, motivo }: Readonly<{ icono: string; motivo: string }>) {
  return (
    <button
      type="button"
      aria-disabled="true"
      aria-label={motivo}
      title={motivo}
      onClick={(e) => e.preventDefault()}
      className={`${CLASE_ACCION} cursor-not-allowed opacity-40`}
    >
      <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
        {icono}
      </span>
    </button>
  );
}
