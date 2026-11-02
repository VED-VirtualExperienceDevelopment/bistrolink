"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import Switch from "@/components/ui/Switch";
import { apiFetch, ApiError } from "@/lib/api-client";
import AnonimizarDatosFactura from "@/components/admin/configuracion/AnonimizarDatosFactura";
import {
  cambiosParaGuardar,
  errorEmailPrivacidad,
  errorRazonSocial,
  formularioDesde,
  hayCambios,
  leerPropinas,
  LARGO_MAXIMO_EMAIL,
  LARGO_MAXIMO_RAZON_SOCIAL,
  MAXIMO_PROPINAS,
  MEDIOS_PAGO,
  PROVEEDORES_CFE,
  sinMediosDePago,
  type CampoMedioPago,
  type ConfiguracionEstablecimiento,
  type FormularioConfiguracion,
} from "@/components/admin/configuracion/configuracion.utils";

const CLASE_CONTROL =
  "min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-error";
const CLASE_ETIQUETA = "mb-1 block text-label-md text-on-surface-variant";
const CLASE_TARJETA =
  "space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 md:p-6";
const CLASE_TITULO_TARJETA = "text-headline-sm text-on-surface";
const CLASE_AYUDA = "text-body-sm text-on-surface-variant";
const CLASE_PROXIMAMENTE =
  "rounded-full bg-surface-container-high px-2 py-0.5 text-label-sm text-on-surface-variant";
const CLASE_BOTON =
  "flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-body-md font-medium text-on-primary hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";

/**
 * HU-020 (BL-72): configuración del establecimiento. El administrador
 * revisa los datos fiscales del emisor, elige el proveedor de CFE, habilita
 * los medios de pago y define los porcentajes de propina sugeridos. Cada
 * cambio queda en el registro de auditoría.
 */
export default function ConfiguracionPage() {
  const { token, hasRole } = useKeycloakAuth();
  const router = useRouter();

  // Solo ADMIN (mismo criterio que Usuarios y Auditoría): un Mozo que llega
  // por URL directa vuelve al mapa de mesas.
  useEffect(() => {
    if (!hasRole("ADMIN")) router.replace("/admin/mesas");
  }, [hasRole, router]);

  const [guardada, setGuardada] = useState<ConfiguracionEstablecimiento | null>(
    null,
  );
  const [formulario, setFormulario] = useState<FormularioConfiguracion | null>(
    null,
  );
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [intentoGuardar, setIntentoGuardar] = useState(false);

  useEffect(() => {
    if (!token || !hasRole("ADMIN")) return;
    apiFetch<ConfiguracionEstablecimiento>("/admin/configuracion", token)
      .then((datos) => {
        setGuardada(datos);
        setFormulario(formularioDesde(datos));
      })
      .catch((err) =>
        setErrorCarga(
          err instanceof ApiError
            ? err.message
            : "No se pudo cargar la configuración",
        ),
      );
  }, [token, hasRole]);

  if (!hasRole("ADMIN")) return null;

  function cambiar<K extends keyof FormularioConfiguracion>(
    campo: K,
    valor: FormularioConfiguracion[K],
  ) {
    setFormulario((actual) =>
      actual ? { ...actual, [campo]: valor } : actual,
    );
    setAviso("");
    setErrorGuardar(null);
  }

  const lecturaPropinas = formulario ? leerPropinas(formulario.propinas) : null;
  const errorPropinas =
    lecturaPropinas && "error" in lecturaPropinas
      ? lecturaPropinas.error
      : null;
  const errorRazon = formulario
    ? errorRazonSocial(formulario.razonSocial)
    : null;
  const errorEmail = formulario
    ? errorEmailPrivacidad(formulario.emailPrivacidad)
    : null;
  const cambios =
    guardada && formulario ? cambiosParaGuardar(guardada, formulario) : {};
  const conCambios = hayCambios(cambios);
  const sinMedios = formulario ? sinMediosDePago(formulario) : false;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setIntentoGuardar(true);
    // Con un error, el foco va al primer campo mal cargado.
    if (errorRazon || errorPropinas || errorEmail) {
      let campo = "email-privacidad";
      if (errorRazon) campo = "razon-social";
      else if (errorPropinas) campo = "propinas";
      document.getElementById(campo)?.focus();
      return;
    }
    if (!guardada || !conCambios) return;
    setGuardando(true);
    setErrorGuardar(null);
    setAviso("");
    try {
      const datos = await apiFetch<ConfiguracionEstablecimiento>(
        "/admin/configuracion",
        token,
        { method: "PATCH", body: JSON.stringify(cambios) },
      );
      setGuardada(datos);
      setFormulario(formularioDesde(datos));
      setIntentoGuardar(false);
      setAviso("Cambios guardados.");
    } catch (err) {
      setErrorGuardar(
        err instanceof ApiError
          ? err.message
          : "No se pudieron guardar los cambios",
      );
    } finally {
      setGuardando(false);
    }
  }

  function descartar() {
    if (!guardada) return;
    setFormulario(formularioDesde(guardada));
    setIntentoGuardar(false);
    setErrorGuardar(null);
    setAviso("Se descartaron los cambios.");
  }

  // Los errores de los campos se muestran al escribir mal o al intentar
  // guardar (no con el campo recién vacío por primera vez).
  const mostrarErrorRazon = errorRazon !== null && intentoGuardar;
  const mostrarErrorEmail = errorEmail !== null && intentoGuardar;

  return (
    <div className="w-full max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-headline-lg text-primary">Configuración</h1>
        <p className="text-body-md text-on-surface-variant">
          Los datos con los que el sistema factura y cobra en tu restaurante.
          Cada cambio queda en el registro de auditoría.
        </p>
      </div>

      {errorCarga && (
        <p
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {errorCarga}
        </p>
      )}

      {!formulario && !errorCarga && (
        <p className={CLASE_AYUDA} aria-live="polite">
          Cargando la configuración…
        </p>
      )}

      {formulario && guardada && (
        <form onSubmit={guardar} noValidate className="space-y-6">
          {/* Datos fiscales del emisor */}
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
                onChange={(e) => cambiar("razonSocial", e.target.value)}
                aria-invalid={mostrarErrorRazon}
                aria-describedby={
                  mostrarErrorRazon ? "razon-social-error" : undefined
                }
                className={CLASE_CONTROL}
              />
              {mostrarErrorRazon && (
                <p
                  id="razon-social-error"
                  className="mt-1 text-body-sm text-error"
                >
                  {errorRazon}
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
                value={guardada.rut}
                readOnly
                aria-describedby="rut-ayuda"
                className={`${CLASE_CONTROL} bg-surface-container text-on-surface-variant`}
              />
              <p id="rut-ayuda" className={`mt-1 ${CLASE_AYUDA}`}>
                Para cambiar el RUT, contactá a BistroLink.
              </p>
            </div>
          </section>

          {/* Proveedor de CFE */}
          <section aria-labelledby="titulo-cfe" className={CLASE_TARJETA}>
            <h2 id="titulo-cfe" className={CLASE_TITULO_TARJETA}>
              Facturación electrónica (CFE)
            </h2>
            <fieldset>
              <legend className={CLASE_ETIQUETA}>Proveedor de CFE</legend>
              <div className="space-y-2">
                {PROVEEDORES_CFE.map(({ codigo, nombre }) => {
                  const disponible =
                    guardada.proveedoresCfeDisponibles.includes(codigo);
                  const id = `cfe-${codigo.toLowerCase()}`;
                  return (
                    <div
                      key={codigo}
                      className="flex min-h-12 items-center gap-3"
                    >
                      <input
                        id={id}
                        type="radio"
                        name="cfe-proveedor"
                        value={codigo}
                        checked={formulario.cfeProveedor === codigo}
                        disabled={!disponible}
                        onChange={() => cambiar("cfeProveedor", codigo)}
                        aria-describedby={
                          disponible ? undefined : `${id}-ayuda`
                        }
                        className="h-5 w-5 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      />
                      <label
                        htmlFor={id}
                        className={`text-body-md ${disponible ? "text-on-surface" : "text-on-surface-variant"}`}
                      >
                        {nombre}
                      </label>
                      {!disponible && (
                        <span id={`${id}-ayuda`} className={CLASE_PROXIMAMENTE}>
                          Próximamente
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </section>

          {/* Medios de pago */}
          <section aria-labelledby="titulo-medios" className={CLASE_TARJETA}>
            <h2 id="titulo-medios" className={CLASE_TITULO_TARJETA}>
              Medios de pago
            </h2>
            <ul className="divide-y divide-outline-variant">
              {MEDIOS_PAGO.map(({ codigo, campo, nombre, descripcion }) => {
                const disponible =
                  guardada.mediosPagoDisponibles.includes(codigo);
                return (
                  <li
                    key={codigo}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="flex items-center gap-2 text-body-md text-on-surface">
                        {nombre}
                        {!disponible && (
                          <span className={CLASE_PROXIMAMENTE}>
                            Próximamente
                          </span>
                        )}
                      </p>
                      <p className={CLASE_AYUDA}>{descripcion}</p>
                    </div>
                    <Switch
                      checked={formulario[campo as CampoMedioPago]}
                      onChange={(valor) => cambiar(campo, valor)}
                      label={`${nombre}${disponible ? "" : " (próximamente)"}`}
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

          {/* Propinas */}
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
                onChange={(e) => cambiar("propinas", e.target.value)}
                aria-invalid={errorPropinas !== null}
                aria-describedby={
                  errorPropinas
                    ? "propinas-ayuda propinas-error"
                    : "propinas-ayuda"
                }
                className={CLASE_CONTROL}
              />
              <p id="propinas-ayuda" className={`mt-1 ${CLASE_AYUDA}`}>
                Hasta {MAXIMO_PROPINAS} porcentajes enteros, separados por
                comas. Dejalo vacío para no sugerir propina.
              </p>
              {errorPropinas && (
                <p id="propinas-error" className="mt-1 text-body-sm text-error">
                  {errorPropinas}
                </p>
              )}
            </div>
          </section>

          {/* HU-036 (BL-206): contacto para los derechos sobre los datos. */}
          <section
            aria-labelledby="titulo-privacidad"
            className={CLASE_TARJETA}
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
                onChange={(e) => cambiar("emailPrivacidad", e.target.value)}
                aria-invalid={mostrarErrorEmail}
                aria-describedby={
                  mostrarErrorEmail
                    ? "email-privacidad-ayuda email-privacidad-error"
                    : "email-privacidad-ayuda"
                }
                className={CLASE_CONTROL}
              />
              <p id="email-privacidad-ayuda" className={`mt-1 ${CLASE_AYUDA}`}>
                Aparece en la política de privacidad de tu local, para que los
                comensales pidan acceso, corrección o eliminación de sus datos
                (Ley 18.331). Si lo dejás vacío, la política les indica
                pedírselo al personal.
              </p>
              {mostrarErrorEmail && (
                <p
                  id="email-privacidad-error"
                  className="mt-1 text-body-sm text-error"
                >
                  {errorEmail}
                </p>
              )}
            </div>
          </section>

          {errorGuardar && (
            <p
              role="alert"
              className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
            >
              {errorGuardar}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={guardando || !conCambios}
              className={CLASE_BOTON}
            >
              {guardando ? "Guardando…" : "Guardar cambios"}
            </button>
            <button
              type="button"
              onClick={descartar}
              disabled={guardando || !conCambios}
              className="min-h-12 rounded-lg px-4 text-body-md text-primary hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Descartar cambios
            </button>
            {/* Mensajes de estado: el lector de pantalla los anuncia sin
                mover el foco. */}
            <p
              className="text-body-md text-on-surface-variant"
              aria-live="polite"
              aria-atomic="true"
            >
              {aviso}
            </p>
          </div>
        </form>
      )}

      {/* HU-009 (BL-453): fuera del formulario (no se guarda con «Guardar
          cambios»). */}
      {formulario && token && <AnonimizarDatosFactura token={token} />}
    </div>
  );
}
