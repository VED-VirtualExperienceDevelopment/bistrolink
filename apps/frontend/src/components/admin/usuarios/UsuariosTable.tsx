'use client';

import type { Usuario } from '@/types/usuario';
import { esCuentaCocina, nombreCompleto, nombreParaMostrar } from './Usuarios.utils';

interface Props {
  usuarios: Usuario[];
  onEditarRol: (usuario: Usuario) => void;
  onDesactivar: (usuario: Usuario) => void;
  onReactivar: (usuario: Usuario) => void;
  onRestablecerContrasena: (usuario: Usuario) => void;
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

export function UsuariosTable({
  usuarios,
  onEditarRol,
  onDesactivar,
  onReactivar,
  onRestablecerContrasena,
}: Props) {
  if (usuarios.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant" aria-hidden="true">
          group
        </span>
        <p className="mt-2 text-body-lg text-on-surface">Todavía no hay usuarios en este restaurante</p>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Usá &ldquo;Nuevo usuario&rdquo; para dar de alta al primer Mozo o Administrador.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className="divide-y divide-outline-variant">
        {usuarios.map((usuario) => (
          <div
            key={usuario.id}
            className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-surface-container-low"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container">
                <span className="material-symbols-outlined text-primary" aria-hidden="true">
                  {ROL_ICONO[usuario.rol]}
                </span>
              </div>
              <div>
                <p className="text-body-md font-semibold text-on-surface">
                  {nombreParaMostrar(usuario)}
                </p>
                {/* BL-361: con nombre cargado, el usuario va debajo (es con lo
                    que la persona ingresa). Sin nombre, ya está arriba. */}
                {/* BL-362: una sola cuenta para toda la cocina. */}
                {esCuentaCocina(usuario) && (
                  <p className="text-label-sm text-on-surface-variant">Cuenta compartida</p>
                )}
                {nombreCompleto(usuario) && usuario.username && (
                  <p className="text-label-sm text-on-surface-variant">
                    Usuario: {usuario.username}
                  </p>
                )}
                {usuario.email && (
                  <p className="text-label-sm text-on-surface-variant">{usuario.email}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-label-sm ${ROL_CLASES[usuario.rol]}`}
              >
                {ROL_LABEL[usuario.rol]}
              </span>

              <span
                className={`inline-flex items-center gap-1.5 text-body-sm ${
                  usuario.activo ? 'text-on-surface-variant' : 'text-error'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${usuario.activo ? 'bg-primary' : 'bg-error'}`}
                  aria-hidden="true"
                />
                {usuario.activo ? 'Activo' : 'Desactivado'}
              </span>

              <div className="flex items-center gap-1">
                {/* BL-362: la cuenta de cocina no cambia de rol. */}
                {!esCuentaCocina(usuario) && (
                  <button
                    type="button"
                    onClick={() => onEditarRol(usuario)}
                    aria-label="Editar rol"
                    title="Editar rol"
                    className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                  >
                    <span className="material-symbols-outlined text-[20px]">edit</span>
                  </button>
                )}
                {/* BL-359: solo para usuarios activos (uno desactivado no podría ingresar). */}
                {usuario.activo && (
                  <button
                    type="button"
                    onClick={() => onRestablecerContrasena(usuario)}
                    aria-label={`Restablecer la contraseña de ${nombreParaMostrar(usuario)}`}
                    title="Restablecer contraseña"
                    className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                  >
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                      lock_reset
                    </span>
                  </button>
                )}
                {usuario.activo && (
                  <button
                    type="button"
                    onClick={() => onDesactivar(usuario)}
                    aria-label="Desactivar usuario"
                    title="Desactivar usuario"
                    className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-error-container hover:text-error"
                  >
                    <span className="material-symbols-outlined text-[20px]">person_off</span>
                  </button>
                )}
                {/* BL-358: un usuario desactivado ya no se queda sin acciones. */}
                {!usuario.activo && (
                  <button
                    type="button"
                    onClick={() => onReactivar(usuario)}
                    aria-label={`Reactivar a ${nombreParaMostrar(usuario)}`}
                    title="Reactivar usuario"
                    className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                  >
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                      how_to_reg
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
