"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import AnonimizarDatosFactura from "@/components/admin/configuracion/AnonimizarDatosFactura";
import BarraGuardar from "@/components/admin/configuracion/BarraGuardar";
import SeccionCocina from "@/components/admin/configuracion/SeccionCocina";
import SeccionMarca from "@/components/admin/configuracion/SeccionMarca";
import {
  SeccionDatosFiscales,
  SeccionFacturacion,
  SeccionMediosPago,
  SeccionPrivacidad,
  SeccionPropinas,
} from "@/components/admin/configuracion/SeccionesConfiguracion";
import {
  CLASE_AYUDA,
  CLASE_ERROR_GENERAL,
} from "@/components/admin/configuracion/configuracion.estilos";
import {
  cambiosParaGuardar,
  erroresDelFormulario,
  formularioDesde,
  hayCambios,
  primerCampoConError,
  sinMediosDePago,
  type ConfiguracionEstablecimiento,
  type FormularioConfiguracion,
} from "@/components/admin/configuracion/configuracion.utils";

const FORM_ID = "form-configuracion";

/**
 * HU-020 (BL-72): configuración del establecimiento. El administrador
 * revisa los datos fiscales del emisor, elige el proveedor de CFE, habilita
 * los medios de pago y define los porcentajes de propina sugeridos. Cada
 * cambio queda en el registro de auditoría.
 * HU-042 (BL-465): también configura la cola de pedidos del KDS.
 * HU-043 (BL-533): y la marca del local (logo y estilo del menú).
 *
 * BL-473: layout. La página ocupa todo el alto del panel (el scroll es el
 * del contenedor de AdminShell), hasta 2 columnas desde 1280 px y una en
 * celular y tablet. «Guardar cambios» va en la barra del final, fija abajo
 * mientras se hace scroll.
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
  // HU-043 (BL-533): cambia al volver a lo guardado (descartar o guardar),
  // para que el cargador del logo muestre el logo guardado.
  const [reinicioMarca, setReinicioMarca] = useState(0);

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

  const errores = erroresDelFormulario(formulario);
  const cambios =
    guardada && formulario ? cambiosParaGuardar(guardada, formulario) : {};
  const conCambios = hayCambios(cambios);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setIntentoGuardar(true);
    // Con un error, el foco va al primer campo mal cargado.
    const campoConError = primerCampoConError(errores);
    if (campoConError) {
      document.getElementById(campoConError)?.focus();
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
      setReinicioMarca((n) => n + 1);
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
    setReinicioMarca((n) => n + 1);
    setIntentoGuardar(false);
    setErrorGuardar(null);
    setAviso("Se descartaron los cambios.");
  }

  // La razón social y el correo muestran su error al intentar guardar (no con
  // el campo recién vacío por primera vez); las propinas, al escribir.
  const errorVisible = (error: string | null) =>
    intentoGuardar ? error : null;

  return (
    <div className="flex min-h-full w-full flex-col px-4 pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-8">
      <div className="w-full flex-1 space-y-6 pb-6">
        <header>
          <h1 className="text-headline-lg text-primary">Configuración</h1>
          <p className="text-body-md text-on-surface-variant">
            Los datos con los que el sistema factura y cobra en tu restaurante.
            Cada cambio queda en el registro de auditoría.
          </p>
        </header>

        {errorCarga && (
          <p role="alert" className={CLASE_ERROR_GENERAL}>
            {errorCarga}
          </p>
        )}

        {!formulario && !errorCarga && (
          <p className={CLASE_AYUDA} aria-live="polite">
            Cargando la configuración…
          </p>
        )}

        {formulario && guardada && (
          <form
            id={FORM_ID}
            onSubmit={guardar}
            noValidate
            aria-label="Configuración del establecimiento"
            className="grid grid-cols-1 gap-6 xl:grid-cols-2"
          >
            <SeccionDatosFiscales
              formulario={formulario}
              onCambiar={cambiar}
              rut={guardada.rut}
              error={errorVisible(errores.razonSocial)}
            />
            <SeccionFacturacion
              formulario={formulario}
              onCambiar={cambiar}
              disponibles={guardada.proveedoresCfeDisponibles}
            />
            <SeccionMediosPago
              formulario={formulario}
              onCambiar={cambiar}
              disponibles={guardada.mediosPagoDisponibles}
              sinMedios={sinMediosDePago(formulario)}
            />
            <SeccionPropinas
              formulario={formulario}
              onCambiar={cambiar}
              error={errores.propinas}
            />
            {/* HU-043 (BL-533): logo y estilo del menú. Solo con un backend
                que ya tiene la marca. */}
            {guardada.plantillasDisponibles && (
              <SeccionMarca
                formulario={formulario}
                guardada={guardada}
                onCambiar={cambiar}
                reinicio={reinicioMarca}
                className="xl:col-span-2"
              />
            )}
            {/* HU-042 (BL-465): cola de pedidos del KDS. */}
            <SeccionCocina
              formulario={formulario}
              errores={intentoGuardar ? errores.cola : {}}
              onCambiar={cambiar}
              className="xl:col-span-2"
            />
            {/* HU-036 (BL-206): contacto para los derechos sobre los datos. */}
            <SeccionPrivacidad
              formulario={formulario}
              onCambiar={cambiar}
              error={errorVisible(errores.email)}
              className="xl:col-span-2"
            />
          </form>
        )}

        {/* HU-009 (BL-453): formulario propio, fuera del de la configuración
            (no se guarda con «Guardar cambios»). */}
        {formulario && token && <AnonimizarDatosFactura token={token} />}
      </div>

      {/* BL-473: al final de la pantalla y fija abajo al hacer scroll. */}
      {formulario && guardada && (
        <BarraGuardar
          formId={FORM_ID}
          conCambios={conCambios}
          guardando={guardando}
          aviso={aviso}
          error={errorGuardar}
          onDescartar={descartar}
        />
      )}
    </div>
  );
}
