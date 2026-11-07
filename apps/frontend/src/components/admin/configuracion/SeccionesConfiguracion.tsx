"use client";

import Switch from "@/components/ui/Switch";
import {
  CLASE_AYUDA,
  CLASE_CONTROL,
  CLASE_CONTROL_SOLO_LECTURA,
  CLASE_ERROR_CAMPO,
  CLASE_ETIQUETA,
  CLASE_FILA_OPCION,
  CLASE_PROXIMAMENTE,
  CLASE_RADIO,
  CLASE_TARJETA,
  CLASE_TITULO_TARJETA,
} from "./configuracion.estilos";
import {
  LARGO_MAXIMO_EMAIL,
  LARGO_MAXIMO_RAZON_SOCIAL,
  MAXIMO_PROPINAS,
  MEDIOS_PAGO,
  PROVEEDORES_CFE,
  type CampoMedioPago,
  type ConfiguracionEstablecimiento,
  type FormularioConfiguracion,
} from "./configuracion.utils";

/**
 * BL-473: secciones del formulario de Configuración (HU-020), separadas de
 * la página para que cada una se lea sola y la página quede como layout.
 * Mismos campos, textos, ids y validaciones que antes.
 */

export type CambiarCampo = <K extends keyof FormularioConfiguracion>(
  campo: K,
  valor: FormularioConfiguracion[K],
) => void;

interface SeccionProps {
  formulario: FormularioConfiguracion;
  onCambiar: CambiarCampo;
}

/** Ids de ayuda y error de un campo, para aria-describedby. */
function describidoPor(id: string, conAyuda: boolean, conError: boolean) {
  const ids = [conAyuda && `${id}-ayuda`, conError && `${id}-error`].filter(
    Boolean,
  );
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function SeccionDatosFiscales({
  formulario,
  onCambiar,
  rut,
  error,
}: Readonly<SeccionProps & { rut: string; error: string | null }>) {
  return (
    <section aria-labelledby="titulo-fiscales" className={CLASE_TARJETA}>
      <h2 id="titulo-fiscales" className={CLASE_TITULO_TARJETA}>
        Datos fiscales del emisor
      </h2>
      <div>
        <label htmlFor="razon-social" className={CLASE_ETIQUETA}>
          Razón social
        </label>
        <input
          id="razon-social"
          type="text"
          autoComplete="organization"
          maxLength={LARGO_MAXIMO_RAZON_SOCIAL}
          value={formulario.razonSocial}
          onChange={(e) => onCambiar("razonSocial", e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={describidoPor("razon-social", false, !!error)}
          className={CLASE_CONTROL}
        />
        {error && (
          <p id="razon-social-error" className={CLASE_ERROR_CAMPO}>
            {error}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="rut" className={CLASE_ETIQUETA}>
          RUT
        </label>
        <input
          id="rut"
          type="text"
          value={rut}
          readOnly
          aria-describedby="rut-ayuda"
          className={CLASE_CONTROL_SOLO_LECTURA}
        />
        <p id="rut-ayuda" className={`mt-1 ${CLASE_AYUDA}`}>
          Para cambiar el RUT, contactá a BistroLink.
        </p>
      </div>
    </section>
  );
}

export function SeccionFacturacion({
  formulario,
  onCambiar,
  disponibles,
}: Readonly<
  SeccionProps & {
    disponibles: ConfiguracionEstablecimiento["proveedoresCfeDisponibles"];
  }
>) {
  return (
    <section aria-labelledby="titulo-cfe" className={CLASE_TARJETA}>
      <h2 id="titulo-cfe" className={CLASE_TITULO_TARJETA}>
        Facturación electrónica (CFE)
      </h2>
      <fieldset>
        <legend className={CLASE_ETIQUETA}>Proveedor de CFE</legend>
        <div className="space-y-1">
          {PROVEEDORES_CFE.map(({ codigo, nombre }) => {
            const disponible = disponibles.includes(codigo);
            const id = `cfe-${codigo.toLowerCase()}`;
            // Toda la fila es la etiqueta: área táctil de 48 px de alto.
            return (
              <label key={codigo} htmlFor={id} className={CLASE_FILA_OPCION}>
                <input
                  id={id}
                  type="radio"
                  name="cfe-proveedor"
                  value={codigo}
                  checked={formulario.cfeProveedor === codigo}
                  disabled={!disponible}
                  onChange={() => onCambiar("cfeProveedor", codigo)}
                  aria-describedby={disponible ? undefined : `${id}-ayuda`}
                  className={CLASE_RADIO}
                />
                <span
                  className={`text-body-md ${disponible ? "text-on-surface" : "text-on-surface-variant"}`}
                >
                  {nombre}
                </span>
                {!disponible && (
                  <span id={`${id}-ayuda`} className={CLASE_PROXIMAMENTE}>
                    Próximamente
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}

export function SeccionMediosPago({
  formulario,
  onCambiar,
  disponibles,
  sinMedios,
}: Readonly<
  SeccionProps & {
    disponibles: ConfiguracionEstablecimiento["mediosPagoDisponibles"];
    sinMedios: boolean;
  }
>) {
  return (
    <section aria-labelledby="titulo-medios" className={CLASE_TARJETA}>
      <h2 id="titulo-medios" className={CLASE_TITULO_TARJETA}>
        Medios de pago
      </h2>
      <ul className="divide-y divide-outline-variant">
        {MEDIOS_PAGO.map(({ codigo, campo, nombre, descripcion }) => {
          const disponible = disponibles.includes(codigo);
          const idDescripcion = `medio-${codigo.toLowerCase()}-descripcion`;
          return (
            <li
              key={codigo}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-body-md text-on-surface">
                  {nombre}
                  {!disponible && (
                    <span className={CLASE_PROXIMAMENTE}>Próximamente</span>
                  )}
                </p>
                <p id={idDescripcion} className={CLASE_AYUDA}>
                  {descripcion}
                </p>
              </div>
              <Switch
                checked={formulario[campo as CampoMedioPago]}
                onChange={(valor) => onCambiar(campo, valor)}
                label={`${nombre}${disponible ? "" : " (próximamente)"}`}
                describedBy={idDescripcion}
                disabled={!disponible}
              />
            </li>
          );
        })}
      </ul>
      {sinMedios && (
        <p role="alert" className="text-body-sm text-error">
          Sin ningún medio habilitado, el restaurante no puede cobrar.
        </p>
      )}
    </section>
  );
}

export function SeccionPropinas({
  formulario,
  onCambiar,
  error,
}: Readonly<SeccionProps & { error: string | null }>) {
  return (
    <section aria-labelledby="titulo-propinas" className={CLASE_TARJETA}>
      <h2 id="titulo-propinas" className={CLASE_TITULO_TARJETA}>
        Propinas sugeridas
      </h2>
      <div>
        <label htmlFor="propinas" className={CLASE_ETIQUETA}>
          Porcentajes sugeridos
        </label>
        <input
          id="propinas"
          type="text"
          inputMode="numeric"
          placeholder="10, 15, 20"
          value={formulario.propinas}
          onChange={(e) => onCambiar("propinas", e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={describidoPor("propinas", true, !!error)}
          className={CLASE_CONTROL}
        />
        <p id="propinas-ayuda" className={`mt-1 ${CLASE_AYUDA}`}>
          Hasta {MAXIMO_PROPINAS} porcentajes enteros, separados por comas.
          Dejalo vacío para no sugerir propina.
        </p>
        {error && (
          <p id="propinas-error" className={CLASE_ERROR_CAMPO}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

export function SeccionPrivacidad({
  formulario,
  onCambiar,
  error,
  className = "",
}: Readonly<SeccionProps & { error: string | null; className?: string }>) {
  return (
    <section
      aria-labelledby="titulo-privacidad"
      className={`${CLASE_TARJETA} ${className}`}
    >
      <h2 id="titulo-privacidad" className={CLASE_TITULO_TARJETA}>
        Privacidad
      </h2>
      <div>
        <label htmlFor="email-privacidad" className={CLASE_ETIQUETA}>
          Correo para consultas de privacidad
        </label>
        <input
          id="email-privacidad"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="privacidad@tulocal.com.uy"
          maxLength={LARGO_MAXIMO_EMAIL}
          value={formulario.emailPrivacidad}
          onChange={(e) => onCambiar("emailPrivacidad", e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={describidoPor("email-privacidad", true, !!error)}
          className={CLASE_CONTROL}
        />
        <p id="email-privacidad-ayuda" className={`mt-1 ${CLASE_AYUDA}`}>
          Aparece en la política de privacidad de tu local, para que los
          comensales pidan acceso, corrección o eliminación de sus datos (Ley
          18.331). Si lo dejás vacío, la política les indica pedírselo al
          personal.
        </p>
        {error && (
          <p id="email-privacidad-error" className={CLASE_ERROR_CAMPO}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
