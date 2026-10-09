'use client';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { FormularioAlta, ResultadoAlta } from '@/types/plataforma';
import {
  construirPedidoAlta,
  credencialesAMostrar,
  ETIQUETA_ROL,
  FORMULARIO_VACIO,
  mensajeDeError,
  resumirAlta,
  validarFormulario,
  type ErroresFormulario,
} from './plataforma.utils';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  /** Se llama después de un alta exitosa (para refrescar el listado). */
  onCreado: (resultado: ResultadoAlta) => void;
}

const CLASE_INPUT =
  'w-full rounded-lg border px-3 py-2 text-body-md text-on-surface focus:outline-none focus:ring-2';

interface CampoProps {
  id: keyof FormularioAlta;
  label: string;
  valor: string;
  error?: string;
  ayuda?: string;
  tipo?: 'text' | 'email';
  inputMode?: 'numeric';
  onChange: (id: keyof FormularioAlta, valor: string) => void;
}

function Campo({ id, label, valor, error, ayuda, tipo = 'text', inputMode, onChange }: CampoProps) {
  const idAyuda = `${id}-ayuda`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-label-md text-on-surface-variant">
        {label}
      </label>
      <input
        id={id}
        type={tipo}
        inputMode={inputMode}
        autoComplete="off"
        value={valor}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || ayuda ? idAyuda : undefined}
        onChange={(e) => onChange(id, e.target.value)}
        className={`${CLASE_INPUT} ${
          error
            ? 'border-error focus:border-error focus:ring-error/20'
            : 'border-outline-variant focus:border-primary focus:ring-primary/20'
        }`}
      />
      {(error || ayuda) && (
        <p id={idAyuda} className={`mt-1 text-body-sm ${error ? 'text-error' : 'text-on-surface-variant'}`}>
          {error ?? ayuda}
        </p>
      )}
    </div>
  );
}

/**
 * BL-163 (HU-027): alta de un establecimiento con el kit mínimo (tenant,
 * restaurante, mesa virtual, Administrador, Cocina y comensal técnico).
 *
 * Las contraseñas del Administrador y de Cocina las genera el backend como
 * temporales y vuelven UNA sola vez en la respuesta (mismo criterio que
 * CrearUsuarioDialog): se muestran acá y no se guardan en ningún lado.
 */
export function AltaEstablecimientoDialog({ open, onClose, token, onCreado }: Props) {
  const [form, setForm] = useState<FormularioAlta>(FORMULARIO_VACIO);
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [enviando, setEnviando] = useState(false);
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoAlta | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const cerrar = () => {
    // Al cerrar se descartan el formulario y las contraseñas mostradas.
    setForm(FORMULARIO_VACIO);
    setErrores({});
    setErrorApi(null);
    setResultado(null);
    setCopiado(null);
    onClose();
  };

  const cambiar = (id: keyof FormularioAlta, valor: string) => {
    setForm((prev) => ({ ...prev, [id]: valor }));
    if (errores[id]) setErrores((prev) => ({ ...prev, [id]: undefined }));
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const encontrados = validarFormulario(form);
    setErrores(encontrados);
    if (Object.keys(encontrados).length > 0) return;

    setEnviando(true);
    setErrorApi(null);
    try {
      const respuesta = await apiFetch<ResultadoAlta>('/plataforma/establecimientos', token, {
        method: 'POST',
        body: JSON.stringify(construirPedidoAlta(form)),
      });
      setResultado(respuesta);
      onCreado(respuesta);
    } catch (err) {
      setErrorApi(
        err instanceof ApiError
          ? mensajeDeError(err.status, err.message)
          : 'No se pudo dar de alta el establecimiento',
      );
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async (username: string, password: string) => {
    await navigator.clipboard.writeText(password);
    setCopiado(username);
  };

  if (resultado) {
    const credenciales = credencialesAMostrar(resultado);
    return (
      <Dialog open={open} onClose={cerrar} title="Establecimiento listo">
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <p className="text-body-md text-on-surface">{resumirAlta(resultado)}</p>

          {credenciales.length > 0 && (
            <>
              <p className="rounded-lg bg-tertiary-fixed px-3 py-2 text-body-sm text-on-tertiary-fixed">
                Estas contraseñas temporales <strong>solo se muestran ahora</strong>. Copialas y pasalas
                por la base KeePass del equipo, nunca por chat ni mail. Keycloak pide cambiarlas en el
                primer ingreso.
              </p>
              <ul className="space-y-2">
                {credenciales.map((u) => (
                  <li
                    key={u.username}
                    className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2"
                  >
                    <p className="text-label-md text-on-surface-variant">
                      {ETIQUETA_ROL[u.rol]} · <span className="font-semibold text-on-surface">{u.username}</span>
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <code className="break-all text-body-md text-on-surface">{u.passwordGenerada}</code>
                      <button
                        type="button"
                        onClick={() => copiar(u.username, u.passwordGenerada as string)}
                        className="shrink-0 text-label-md font-semibold text-primary hover:underline"
                      >
                        {copiado === u.username ? 'Copiada' : 'Copiar'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button
            type="button"
            onClick={cerrar}
            className="w-full rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90"
          >
            Listo
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={cerrar} title="Nuevo establecimiento">
      <form onSubmit={enviar} noValidate className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        <fieldset className="space-y-3">
          <legend className="mb-1 text-label-md font-semibold text-on-surface">Empresa</legend>
          <Campo id="razonSocial" label="Razón social" valor={form.razonSocial} error={errores.razonSocial} onChange={cambiar} />
          <Campo
            id="rut"
            label="RUT"
            valor={form.rut}
            error={errores.rut}
            ayuda="12 dígitos, sin puntos ni guiones. Si el RUT ya existe, se completa ese establecimiento."
            inputMode="numeric"
            onChange={cambiar}
          />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-label-md font-semibold text-on-surface">Restaurante</legend>
          <Campo id="restauranteNombre" label="Nombre" valor={form.restauranteNombre} error={errores.restauranteNombre} onChange={cambiar} />
          <Campo id="restauranteDireccion" label="Dirección" valor={form.restauranteDireccion} error={errores.restauranteDireccion} onChange={cambiar} />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-label-md font-semibold text-on-surface">Administrador</legend>
          <Campo id="adminUsername" label="Usuario" valor={form.adminUsername} error={errores.adminUsername} onChange={cambiar} />
          <Campo id="adminEmail" label="Email" tipo="email" valor={form.adminEmail} error={errores.adminEmail} onChange={cambiar} />
          <div className="grid grid-cols-2 gap-3">
            <Campo id="adminNombre" label="Nombre" valor={form.adminNombre} error={errores.adminNombre} onChange={cambiar} />
            <Campo id="adminApellido" label="Apellido" valor={form.adminApellido} error={errores.adminApellido} onChange={cambiar} />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-label-md font-semibold text-on-surface">Cocina (monitor de pedidos)</legend>
          <Campo id="cocinaUsername" label="Usuario" valor={form.cocinaUsername} error={errores.cocinaUsername} onChange={cambiar} />
          <Campo
            id="cocinaEmail"
            label="Email (opcional)"
            tipo="email"
            valor={form.cocinaEmail}
            error={errores.cocinaEmail}
            ayuda="Si lo dejás vacío, se usa uno técnico."
            onChange={cambiar}
          />
        </fieldset>

        <p className="text-body-sm text-on-surface-variant">
          Las contraseñas del Administrador y de Cocina las genera el sistema. El comensal técnico y la mesa
          virtual se crean solos.
        </p>

        {errorApi && (
          <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
            {errorApi}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={cerrar}
            className="rounded-lg px-4 py-2 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando}
            className="rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {enviando ? 'Dando de alta…' : 'Dar de alta'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
