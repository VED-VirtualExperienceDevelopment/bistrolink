"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import { CampoNombrePersona } from "@/components/admin/usuarios/CampoNombrePersona";
import {
  AYUDA_USERNAME,
  LARGO_MAXIMO_EMAIL,
  LARGO_MAXIMO_USERNAME,
} from "@/components/admin/usuarios/Usuarios.utils";
import type {
  AdministradorCreado,
  FormularioAdministrador,
} from "@/types/plataforma";
import {
  construirPedidoAdministrador,
  FORMULARIO_ADMIN_VACIO,
  mensajeErrorAccesoAdmin,
  nombreDeCuenta,
  rutaAdministradores,
  validarFormularioAdministrador,
  type ErroresAdministrador,
} from "./plataforma.utils";
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  ConfirmarCierreSinCopiar,
  ContrasenaTemporal,
} from "./ContrasenaTemporal";

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  tenantId: string;
  /** Después de crearlo (para refrescar la ficha sin cerrar el diálogo). */
  onCreado: (administrador: AdministradorCreado) => void;
}

// Ids de los campos: el foco va al primero con error.
const ID = {
  nombre: "admin-nuevo-nombre",
  apellido: "admin-nuevo-apellido",
  username: "admin-nuevo-username",
  email: "admin-nuevo-email",
} as const;

const CLASE_INPUT =
  "min-h-12 w-full rounded-lg border px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

// Orden de los campos en el formulario.
const ORDEN: (keyof FormularioAdministrador)[] = [
  "nombre",
  "apellido",
  "username",
  "email",
];

/**
 * BL-414: agregar un Administrador nuevo a un establecimiento, por ejemplo
 * cuando el único que había se fue del restaurante. Mismo formulario que
 * «Nuevo usuario» (BL-361, BL-356), con el correo obligatorio como en el
 * alta, y la contraseña temporal una sola vez, con confirmación si se cierra
 * sin copiarla (BL-408).
 *
 * Los errores van junto a cada campo (aria-describedby y aria-invalid) y se
 * muestran después del primer intento de guardar; el foco va al primero con
 * error. Sin `required` del navegador: el mensaje es siempre el nuestro.
 */
export function AgregarAdministradorDialog({
  open,
  onClose,
  token,
  tenantId,
  onCreado,
}: Readonly<Props>) {
  const [form, setForm] = useState<FormularioAdministrador>(
    FORMULARIO_ADMIN_VACIO,
  );
  const [errores, setErrores] = useState<ErroresAdministrador>({});
  const [enviando, setEnviando] = useState(false);
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [creado, setCreado] = useState<AdministradorCreado | null>(null);
  const [copiada, setCopiada] = useState(false);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const botonCopiar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (creado) botonCopiar.current?.focus();
  }, [creado]);

  const intentarCerrar = () => {
    if (creado && !copiada && !confirmandoCierre) {
      setConfirmandoCierre(true);
      return;
    }
    onClose();
  };

  const volverALaContrasena = () => {
    setConfirmandoCierre(false);
    requestAnimationFrame(() => botonCopiar.current?.focus());
  };

  const cambiar = (campo: keyof FormularioAdministrador, valor: string) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    if (errores[campo]) {
      setErrores((prev) => ({ ...prev, [campo]: undefined }));
    }
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const encontrados = validarFormularioAdministrador(form);
    setErrores(encontrados);
    const primero = ORDEN.find((campo) => encontrados[campo]);
    if (primero) {
      document.getElementById(ID[primero])?.focus();
      return;
    }

    setEnviando(true);
    setErrorApi(null);
    try {
      const respuesta = await apiFetch<AdministradorCreado>(
        rutaAdministradores(tenantId),
        token,
        {
          method: "POST",
          body: JSON.stringify(construirPedidoAdministrador(form)),
        },
      );
      setCreado(respuesta);
      onCreado(respuesta);
    } catch (err) {
      setErrorApi(
        err instanceof ApiError
          ? mensajeErrorAccesoAdmin(err.status, err.message)
          : "No se pudo crear el Administrador",
      );
    } finally {
      setEnviando(false);
    }
  };

  if (creado) {
    const nombre = nombreDeCuenta(creado);
    return (
      <Dialog
        open={open}
        onClose={intentarCerrar}
        title="Administrador agregado"
      >
        <div className="space-y-4">
          <p className="text-body-md text-on-surface">
            <strong>{nombre}</strong> ya es Administrador. Ingresa con el
            usuario <strong>{creado.username ?? form.username}</strong>.
          </p>
          <p className="rounded-lg bg-tertiary-fixed px-3 py-2 text-body-md text-on-tertiary-fixed">
            <strong>Esta contraseña temporal solo se muestra ahora.</strong>{" "}
            Pasala por la base KeePass del equipo, nunca por chat ni mail. Al
            ingresar, le va a pedir que elija una nueva.
          </p>
          <ContrasenaTemporal
            ref={botonCopiar}
            idBase={`admin-${creado.id}`}
            contrasena={creado.temporaryPassword}
            deQuien={nombre}
            copiada={copiada}
            onCopiada={() => setCopiada(true)}
          />
          {confirmandoCierre ? (
            <ConfirmarCierreSinCopiar
              onCerrarIgual={onClose}
              onVolver={volverALaContrasena}
            />
          ) : (
            <button
              type="button"
              onClick={intentarCerrar}
              className={`${CLASE_BOTON_PRIMARIO} w-full`}
            >
              Listo
            </button>
          )}
        </div>
      </Dialog>
    );
  }

  const descripcion = (campo: "username" | "email", ayuda?: string) =>
    [ayuda, errores[campo] ? `${ID[campo]}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <Dialog open={open} onClose={onClose} title="Agregar Administrador">
      <form onSubmit={enviar} noValidate className="space-y-4">
        <p className="text-body-md text-on-surface-variant">
          Para cuando el restaurante se quedó sin Administrador o el que tenía
          se fue. Tiene acceso completo al panel del restaurante.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoNombrePersona
            id={ID.nombre}
            etiqueta="Nombre"
            valor={form.nombre}
            onChange={(valor) => cambiar("nombre", valor)}
            error={errores.nombre ?? null}
            requerido
          />
          <CampoNombrePersona
            id={ID.apellido}
            etiqueta="Apellido"
            valor={form.apellido}
            onChange={(valor) => cambiar("apellido", valor)}
            error={errores.apellido ?? null}
            requerido
          />
        </div>

        <div>
          <label
            htmlFor={ID.username}
            className="mb-1 block text-label-md text-on-surface-variant"
          >
            Usuario para ingresar
          </label>
          {/* Se escribe en minúsculas porque Keycloak guarda así el usuario. */}
          <input
            id={ID.username}
            aria-required
            maxLength={LARGO_MAXIMO_USERNAME}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={form.username}
            onChange={(e) => cambiar("username", e.target.value.toLowerCase())}
            aria-invalid={errores.username ? true : undefined}
            aria-describedby={descripcion("username", `${ID.username}-ayuda`)}
            className={`${CLASE_INPUT} ${errores.username ? "border-error" : "border-outline-variant"}`}
          />
          <p
            id={`${ID.username}-ayuda`}
            className="mt-1 text-body-sm text-on-surface-variant"
          >
            {AYUDA_USERNAME}
          </p>
          {errores.username && (
            <p
              id={`${ID.username}-error`}
              className="mt-1 text-body-sm text-error"
            >
              {errores.username}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor={ID.email}
            className="mb-1 block text-label-md text-on-surface-variant"
          >
            Correo
          </label>
          <input
            id={ID.email}
            type="email"
            aria-required
            maxLength={LARGO_MAXIMO_EMAIL}
            autoComplete="off"
            value={form.email}
            onChange={(e) => cambiar("email", e.target.value)}
            aria-invalid={errores.email ? true : undefined}
            aria-describedby={descripcion("email")}
            className={`${CLASE_INPUT} ${errores.email ? "border-error" : "border-outline-variant"}`}
          />
          {errores.email && (
            <p id={`${ID.email}-error`} className="mt-1 text-body-sm text-error">
              {errores.email}
            </p>
          )}
        </div>

        {errorApi && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container"
          >
            {errorApi}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className={CLASE_BOTON_SECUNDARIO}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando}
            aria-busy={enviando}
            className={CLASE_BOTON_PRIMARIO}
          >
            {enviando ? "Agregando…" : "Agregar Administrador"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}