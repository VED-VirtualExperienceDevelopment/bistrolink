"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import type {
  FichaEstablecimiento,
  FormularioEdicion,
} from "@/types/plataforma";
import {
  cambiosDeEdicion,
  formularioEdicionDesde,
  mensajeErrorEdicion,
  opcionesPlan,
  rutaFicha,
  validarEdicion,
} from "./plataforma.utils";

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  ficha: FichaEstablecimiento;
  /** Recibe la ficha actualizada que devuelve el PATCH. */
  onActualizado: (ficha: FichaEstablecimiento) => void;
}

const CLASE_INPUT =
  "min-h-12 w-full rounded-lg border bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

// Orden de los campos en pantalla: al guardar con errores, el foco va al
// primero que tenga uno.
const ORDEN_CAMPOS: (keyof FormularioEdicion)[] = [
  "razonSocial",
  "rut",
  "plan",
  "restauranteNombre",
  "restauranteDireccion",
];

function Campo({
  campo,
  etiqueta,
  valor,
  onChange,
  error,
  ayuda,
  maxLength,
  inputMode,
}: Readonly<{
  campo: keyof FormularioEdicion;
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  error?: string;
  ayuda?: string;
  maxLength: number;
  inputMode?: "numeric";
}>) {
  const id = `editar-${campo}`;
  const descripciones = [ayuda && `${id}-ayuda`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-label-md text-on-surface-variant"
      >
        {etiqueta}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        inputMode={inputMode}
        maxLength={maxLength}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={descripciones || undefined}
        className={`${CLASE_INPUT} ${error ? "border-error" : "border-outline-variant"}`}
      />
      {ayuda && (
        <p
          id={`${id}-ayuda`}
          className="mt-1 text-body-sm text-on-surface-variant"
        >
          {ayuda}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * BL-412: «Editar» en la ficha del establecimiento. Mismos lineamientos que
 * «Editar usuario» (BL-366): los valores actuales cargados, los errores
 * recién después del primer intento de guardar, el foco al primer campo con
 * error y solo lo que cambió en el PATCH.
 *
 * Cambiar el RUT pide un segundo paso de confirmación: el RUT es la clave
 * del establecimiento y el emisor de sus comprobantes fiscales (CFE). Si se
 * carga mal, los CFE salen a nombre de otro contribuyente.
 *
 * El diálogo toma los datos de la ficha al montarse: la página lo monta de
 * nuevo cada vez que se abre (key), así nunca queda con valores viejos.
 */
export function EditarEstablecimientoDialog({
  open,
  onClose,
  token,
  ficha,
  onActualizado,
}: Readonly<Props>) {
  const [formulario, setFormulario] = useState<FormularioEdicion>(() =>
    formularioEdicionDesde(ficha),
  );
  const [intentoGuardar, setIntentoGuardar] = useState(false);
  const [confirmandoRut, setConfirmandoRut] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tieneRestaurante = ficha.restaurante !== null;
  const errores = validarEdicion(formulario, tieneRestaurante);
  const visibles = intentoGuardar ? errores : {};
  const cambios = cambiosDeEdicion(ficha, formulario);
  const hayCambios = Object.keys(cambios).length > 0;

  const actualizar = (campo: keyof FormularioEdicion) => (valor: string) =>
    setFormulario((f) => ({ ...f, [campo]: valor }));

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const actualizada = await apiFetch<FichaEstablecimiento>(
        rutaFicha(ficha.tenantId),
        token,
        { method: "PATCH", body: JSON.stringify(cambios) },
      );
      onActualizado(actualizada);
      onClose();
    } catch (err) {
      setConfirmandoRut(false);
      setError(
        err instanceof ApiError
          ? mensajeErrorEdicion(err.status, err.message)
          : "No se pudieron guardar los cambios",
      );
    } finally {
      setGuardando(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIntentoGuardar(true);
    const primero = ORDEN_CAMPOS.find((campo) => errores[campo]);
    if (primero) {
      document.getElementById(`editar-${primero}`)?.focus();
      return;
    }
    if (!hayCambios) return;
    if (cambios.rut) {
      setConfirmandoRut(true);
      return;
    }
    void guardar();
  };

  if (confirmandoRut && cambios.rut) {
    return (
      <Dialog open={open} onClose={onClose} title="¿Cambiar el RUT?">
        <div className="space-y-4 text-body-md text-on-surface">
          <p>
            Vas a cambiar el RUT de <strong>{ficha.razonSocial}</strong> de{" "}
            <strong>{ficha.rut}</strong> a <strong>{cambios.rut}</strong>.
          </p>
          <p className="rounded-lg bg-tertiary-fixed px-3 py-2 text-on-tertiary-fixed">
            El RUT es el emisor de los comprobantes fiscales (CFE) del
            establecimiento. Los que se emitan desde ahora salen con el RUT
            nuevo. Confirmá que es el del mismo contribuyente y que está bien
            escrito.
          </p>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
            >
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirmandoRut(false)}
              className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
            >
              Volver
            </button>
            <button
              type="button"
              data-autofocus
              onClick={() => void guardar()}
              disabled={guardando}
              className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Sí, cambiar el RUT"}
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Editar ${ficha.razonSocial}`}
      tamano="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <fieldset className="space-y-4">
          <legend className="mb-2 text-label-lg text-on-surface">
            Establecimiento
          </legend>
          <Campo
            campo="razonSocial"
            etiqueta="Razón social"
            valor={formulario.razonSocial}
            onChange={actualizar("razonSocial")}
            error={visibles.razonSocial}
            maxLength={200}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              campo="rut"
              etiqueta="RUT"
              valor={formulario.rut}
              onChange={actualizar("rut")}
              error={visibles.rut}
              ayuda="Con o sin puntos y guiones. Cambiarlo pide confirmación."
              maxLength={20}
              inputMode="numeric"
            />
            <div>
              <label
                htmlFor="editar-plan"
                className="mb-1 block text-label-md text-on-surface-variant"
              >
                Plan
              </label>
              <select
                id="editar-plan"
                value={formulario.plan}
                onChange={(e) => actualizar("plan")(e.target.value)}
                className={`${CLASE_INPUT} border-outline-variant`}
              >
                {opcionesPlan(ficha.plan).map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-label-lg text-on-surface">
            Restaurante
          </legend>
          {tieneRestaurante ? (
            <>
              <Campo
                campo="restauranteNombre"
                etiqueta="Nombre"
                valor={formulario.restauranteNombre}
                onChange={actualizar("restauranteNombre")}
                error={visibles.restauranteNombre}
                maxLength={120}
              />
              <Campo
                campo="restauranteDireccion"
                etiqueta="Dirección"
                valor={formulario.restauranteDireccion}
                onChange={actualizar("restauranteDireccion")}
                error={visibles.restauranteDireccion}
                maxLength={200}
              />
            </>
          ) : (
            <p className="text-body-md text-on-surface-variant">
              Todavía no tiene restaurante: se carga al completar el alta.
            </p>
          )}
        </fieldset>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando || !hayCambios}
            className="min-h-12 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
