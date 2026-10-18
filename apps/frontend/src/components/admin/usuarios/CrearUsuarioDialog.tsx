'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { CrearUsuarioResponse, UsuarioRol } from '@/types/usuario';
import { errorNombrePersona, LARGO_MAXIMO_NOMBRE, nombreParaMostrar } from './Usuarios.utils';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  restauranteId: string;
  onCreated: (usuario: CrearUsuarioResponse) => void;
}

const CLASE_INPUT =
  'min-h-12 w-full rounded-lg border px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

export function CrearUsuarioDialog({ open, onClose, token, restauranteId, onCreated }: Props) {
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<UsuarioRol>('MOZO');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // BL-361: errores de nombre y apellido, junto a cada campo. Se muestran
  // recién después del primer intento de guardar, para no marcar en rojo
  // un campo que la persona todavía no llenó. Esos dos campos no usan
  // `required` del navegador: así el mensaje es siempre el nuestro, en
  // español y asociado al campo.
  const [intentoGuardar, setIntentoGuardar] = useState(false);
  const [creado, setCreado] = useState<CrearUsuarioResponse | null>(null);
  // BL-364: al mostrar la contraseña temporal, el foco va a «Copiar» (el
  // formulario desaparece y sin esto el foco se perdería).
  const copiarRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (creado) copiarRef.current?.focus();
  }, [creado]);

  const errorNombre = intentoGuardar ? errorNombrePersona(nombre, 'nombre') : null;
  const errorApellido = intentoGuardar ? errorNombrePersona(apellido, 'apellido') : null;

  const resetAndClose = () => {
    setNombre('');
    setApellido('');
    setUsername('');
    setEmail('');
    setRol('MOZO');
    setError(null);
    setIntentoGuardar(false);
    setCreado(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIntentoGuardar(true);
    const primerError = errorNombrePersona(nombre, 'nombre')
      ? 'nombre'
      : errorNombrePersona(apellido, 'apellido')
        ? 'apellido'
        : null;
    if (primerError) {
      // El foco va al primer campo con error, así el lector de pantalla lo
      // lee junto con su mensaje (aria-describedby).
      document.getElementById(primerError)?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const usuario = await apiFetch<CrearUsuarioResponse>('/usuarios', token, {
        method: 'POST',
        body: JSON.stringify({
          username,
          email: email || undefined,
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          rol,
          restauranteId,
        }),
      });
      setCreado(usuario);
      onCreated(usuario);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={resetAndClose} title="Nuevo usuario">
      {creado ? (
        <div className="space-y-4">
          <p className="text-body-md text-on-surface">
            Usuario de <strong>{nombreParaMostrar(creado)}</strong> creado. Ingresa con el usuario{' '}
            <strong>{creado.username ?? username}</strong>. Esta contraseña temporal solo se muestra
            una vez — copiala antes de cerrar esta ventana.
          </p>
          <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
            <code className="text-body-md text-on-surface">{creado.temporaryPassword}</code>
            <button
              type="button"
              ref={copiarRef}
              onClick={() => navigator.clipboard.writeText(creado.temporaryPassword)}
              className="min-h-12 rounded-lg px-3 text-label-md font-semibold text-primary hover:bg-surface-container"
            >
              Copiar
            </button>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="min-h-12 w-full rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90"
          >
            Listo
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* BL-361: nombre y apellido, obligatorios. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="nombre" className="mb-1 block text-label-md text-on-surface-variant">
                Nombre
              </label>
              <input
                id="nombre"
                aria-required="true"
                maxLength={LARGO_MAXIMO_NOMBRE}
                autoComplete="off"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                aria-invalid={errorNombre ? true : undefined}
                aria-describedby={errorNombre ? 'nombre-error' : undefined}
                className={`${CLASE_INPUT} ${errorNombre ? 'border-error' : 'border-outline-variant'}`}
              />
              {errorNombre && (
                <p id="nombre-error" className="mt-1 text-body-sm text-error">
                  {errorNombre}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="apellido" className="mb-1 block text-label-md text-on-surface-variant">
                Apellido
              </label>
              <input
                id="apellido"
                aria-required="true"
                maxLength={LARGO_MAXIMO_NOMBRE}
                autoComplete="off"
                value={apellido}
                onChange={(e) => setApellido(e.target.value)}
                aria-invalid={errorApellido ? true : undefined}
                aria-describedby={errorApellido ? 'apellido-error' : undefined}
                className={`${CLASE_INPUT} ${errorApellido ? 'border-error' : 'border-outline-variant'}`}
              />
              {errorApellido && (
                <p id="apellido-error" className="mt-1 text-body-sm text-error">
                  {errorApellido}
                </p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="username" className="mb-1 block text-label-md text-on-surface-variant">
              Nombre de usuario
            </label>
            <input
              id="username"
              required
              minLength={3}
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`${CLASE_INPUT} border-outline-variant`}
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-label-md text-on-surface-variant">
              Email (opcional)
            </label>
            <input
              id="email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${CLASE_INPUT} border-outline-variant`}
            />
          </div>

          <div>
            <label htmlFor="rol" className="mb-1 block text-label-md text-on-surface-variant">
              Rol
            </label>
            <select
              id="rol"
              value={rol}
              onChange={(e) => setRol(e.target.value as UsuarioRol)}
              className={`${CLASE_INPUT} border-outline-variant`}
            >
              <option value="MOZO">Mozo</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={resetAndClose}
              className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
