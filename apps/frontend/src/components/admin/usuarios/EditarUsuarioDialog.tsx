'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { Usuario, UsuarioRol } from '@/types/usuario';
import { CampoNombrePersona } from './CampoNombrePersona';
import {
  cambiosDeUsuario,
  errorNombreEditado,
  LARGO_MAXIMO_EMAIL,
  nombreParaMostrar,
  primerCampoConError,
} from './Usuarios.utils';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  usuario: Usuario | null;
  /** BL-369: es el usuario de quien edita. Puede cambiar sus datos, no su rol. */
  esPropio?: boolean;
  onUpdated: (usuario: Usuario) => void;
}

const CLASE_INPUT =
  'min-h-12 w-full rounded-lg border px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

/**
 * BL-366: «Editar usuario» (antes «Editar rol»). Nombre, apellido, correo y
 * rol; el usuario con el que ingresa la persona no se edita. Se manda solo
 * lo que cambió.
 *
 * El formulario toma los valores del usuario al montarse: la página lo monta
 * de nuevo para cada usuario (key={usuario.id}), así nunca muestra los datos
 * de la persona anterior.
 */
export function EditarUsuarioDialog({
  open,
  onClose,
  token,
  usuario,
  esPropio = false,
  onUpdated,
}: Readonly<Props>) {
  // BL-362: la cuenta de cocina no llega acá (la tabla no ofrece «Editar»
  // para ella); igual, el valor inicial solo puede ser un rol asignable.
  const rolInicial: UsuarioRol = usuario?.rol === 'ADMIN' ? 'ADMIN' : 'MOZO';
  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [apellido, setApellido] = useState(usuario?.apellido ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [rol, setRol] = useState<UsuarioRol>(rolInicial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intentoGuardar, setIntentoGuardar] = useState(false);

  if (!usuario) return null;

  const erroresActuales = {
    nombre: errorNombreEditado(nombre, usuario.nombre, 'nombre'),
    apellido: errorNombreEditado(apellido, usuario.apellido, 'apellido'),
  };
  // Los errores se muestran recién después del primer intento de guardar.
  const errorNombre = intentoGuardar ? erroresActuales.nombre : null;
  const errorApellido = intentoGuardar ? erroresActuales.apellido : null;

  // Solo lo que cambió.
  const cambios = cambiosDeUsuario(usuario, rolInicial, { nombre, apellido, email, rol });
  const hayCambios = Object.keys(cambios).length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIntentoGuardar(true);
    const primerError = primerCampoConError([
      ['editar-nombre', erroresActuales.nombre],
      ['editar-apellido', erroresActuales.apellido],
    ]);
    if (primerError) {
      document.getElementById(primerError)?.focus();
      return;
    }
    if (!hayCambios) return;

    setSubmitting(true);
    setError(null);
    try {
      const actualizado = await apiFetch<Usuario>(`/usuarios/${usuario.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(cambios),
      });
      onUpdated(actualizado);
      onClose();
    } catch (err) {
      // El 409 de RF.19 («no se puede degradar al último Admin») y el del
      // correo ya usado llegan con el mensaje del backend: se muestran tal cual.
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar los cambios');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Editar a ${nombreParaMostrar(usuario)}`}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoNombrePersona
            id="editar-nombre"
            etiqueta="Nombre"
            valor={nombre}
            onChange={setNombre}
            error={errorNombre}
          />
          <CampoNombrePersona
            id="editar-apellido"
            etiqueta="Apellido"
            valor={apellido}
            onChange={setApellido}
            error={errorApellido}
          />
        </div>

        <div>
          <label htmlFor="editar-email" className="mb-1 block text-label-md text-on-surface-variant">
            Correo
          </label>
          <input
            id="editar-email"
            type="email"
            maxLength={LARGO_MAXIMO_EMAIL}
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby="editar-email-ayuda"
            className={`${CLASE_INPUT} border-outline-variant`}
          />
          <p id="editar-email-ayuda" className="mt-1 text-body-sm text-on-surface-variant">
            Se puede cambiar, no borrar.
          </p>
        </div>

        <div>
          <label htmlFor="editar-rol" className="mb-1 block text-label-md text-on-surface-variant">
            Rol
          </label>
          <select
            id="editar-rol"
            value={rol}
            onChange={(e) => setRol(e.target.value as UsuarioRol)}
            disabled={esPropio}
            aria-describedby={esPropio ? 'editar-rol-ayuda' : undefined}
            className={`${CLASE_INPUT} border-outline-variant disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <option value="MOZO">Mozo</option>
            <option value="ADMIN">Administrador</option>
          </select>
          {/* BL-369: el backend también lo rechaza (403). */}
          {esPropio && (
            <p id="editar-rol-ayuda" className="mt-1 text-body-sm text-on-surface-variant">
              No podés cambiar tu propio rol. Pedíselo a otro Administrador.
            </p>
          )}
        </div>

        {usuario.username && (
          <p className="text-body-md text-on-surface-variant">
            Usuario para ingresar: <strong>{usuario.username}</strong> (no se puede cambiar).
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || !hayCambios}
            className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
