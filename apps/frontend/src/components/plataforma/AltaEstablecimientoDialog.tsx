"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import Switch from "@/components/ui/Switch";
import { apiFetch, ApiError } from "@/lib/api-client";
import type {
  CampoTextoAlta,
  EstablecimientoListado,
  FormularioAlta,
  ResultadoAlta,
  UsuarioAprovisionado,
} from "@/types/plataforma";
import {
  avisoDeCopia,
  construirPedidoAlta,
  contrasenasSinCopiar,
  credencialesAMostrar,
  ETIQUETA_ROL,
  FORMULARIO_VACIO,
  formularioParaCompletar,
  LIMITE_PREPARACION,
  LIMITE_PREPARACION_SUGERIDO,
  mensajeDeError,
  resumirAlta,
  validarFormulario,
  type ErroresFormulario,
} from "./plataforma.utils";

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  /** Se llama después de un alta exitosa (para refrescar el listado). */
  onCreado: (resultado: ResultadoAlta) => void;
  /**
   * BL-407: establecimiento con el alta incompleta. Si viene, el diálogo
   * abre en modo «Completar alta», con la razón social y el RUT del tenant
   * fijos.
   */
  completar?: EstablecimientoListado | null;
}

// BL-408: campos de 48 px (como Usuarios, BL-364).
const CLASE_INPUT =
  "min-h-12 w-full rounded-lg border px-3 text-body-md text-on-surface focus:outline-none focus:ring-2";

// BL-408: botones de 48 px.
const CLASE_BOTON_PRIMARIO =
  "flex min-h-12 items-center justify-center rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90 disabled:opacity-50";
const CLASE_BOTON_SECUNDARIO =
  "flex min-h-12 items-center justify-center rounded-lg px-4 text-body-md text-on-surface-variant hover:bg-surface-container";

interface CampoProps {
  id: CampoTextoAlta;
  label: string;
  valor: string;
  error?: string;
  ayuda?: string;
  tipo?: "text" | "email";
  inputMode?: "numeric";
  /** BL-407: dato del tenant existente, que no se cambia al completar el alta. */
  soloLectura?: boolean;
  /** BL-407: el diálogo pone el foco acá al abrir (data-autofocus de Dialog). */
  enfocar?: boolean;
  onChange: (id: CampoTextoAlta, valor: string) => void;
}

function Campo({
  id,
  label,
  valor,
  error,
  ayuda,
  tipo = "text",
  inputMode,
  soloLectura = false,
  enfocar = false,
  onChange,
}: Readonly<CampoProps>) {
  const idAyuda = `${id}-ayuda`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-label-md text-on-surface-variant"
      >
        {label}
      </label>
      <input
        id={id}
        type={tipo}
        inputMode={inputMode}
        autoComplete="off"
        value={valor}
        readOnly={soloLectura}
        data-autofocus={enfocar ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || ayuda ? idAyuda : undefined}
        onChange={(e) => onChange(id, e.target.value)}
        className={`${CLASE_INPUT} ${
          error
            ? "border-error focus:border-error focus:ring-error/20"
            : "border-outline-variant focus:border-primary focus:ring-primary/20"
        } ${soloLectura ? "bg-surface-container text-on-surface-variant" : ""}`}
      />
      {(error || ayuda) && (
        <p
          id={idAyuda}
          className={`mt-1 text-body-md ${error ? "text-error" : "text-on-surface-variant"}`}
        >
          {error ?? ayuda}
        </p>
      )}
    </div>
  );
}

interface SeccionProps {
  id: string;
  icono: string;
  titulo: string;
  descripcion: string;
  children: React.ReactNode;
}

/**
 * BL-408: cada parte del alta en su propia tarjeta, con ícono, título y una
 * frase que dice para qué es. Es un <fieldset>: el lector de pantalla anuncia
 * el título del grupo al entrar a cualquiera de sus campos, y la descripción
 * queda asociada al grupo con aria-describedby.
 *
 * El <legend> va flotado (float-left w-full): así se dibuja dentro de la
 * tarjeta como un título común, en lugar de cortar el borde del fieldset.
 */
function Seccion({
  id,
  icono,
  titulo,
  descripcion,
  children,
}: Readonly<SeccionProps>) {
  const idDescripcion = `${id}-descripcion`;
  return (
    <fieldset
      aria-describedby={idDescripcion}
      className="min-w-0 rounded-xl border border-outline-variant bg-surface-container-low p-4"
    >
      <legend className="float-left flex w-full items-center gap-2 text-body-lg font-semibold text-on-surface">
        <span
          className="material-symbols-outlined text-[22px] text-primary"
          aria-hidden="true"
        >
          {icono}
        </span>
        {titulo}
      </legend>
      <p
        id={idDescripcion}
        className="clear-both pt-1 text-body-md text-on-surface-variant"
      >
        {descripcion}
      </p>
      <div className="mt-4 space-y-3">{children}</div>
    </fieldset>
  );
}

/**
 * BL-163 (HU-027): alta de un establecimiento con el kit mínimo (tenant,
 * restaurante, mesa virtual, Administrador, Cocina y comensal técnico).
 *
 * Las contraseñas del Administrador y de Cocina las genera el backend como
 * temporales y vuelven UNA sola vez en la respuesta (mismo criterio que
 * CrearUsuarioDialog): se muestran acá y no se guardan en ningún lado.
 *
 * BL-407: con `completar`, el mismo formulario completa un alta incompleta.
 * El backend es idempotente por RUT: no duplica el tenant y crea lo que
 * falta. La razón social y el RUT quedan fijos (otro RUT sería otro
 * establecimiento).
 *
 * BL-408 (contraseñas): cerrar con contraseñas sin copiar pide confirmación,
 * y cada copia se anuncia; si el portapapeles falla, la contraseña queda
 * seleccionada para copiarla a mano.
 *
 * BL-408: diálogo ancho (tamano="lg") y sin caja con scroll propia (había
 * dos barras de desplazamiento). Las cuatro partes van en tarjetas: en PC,
 * de a dos por fila; en el celular, una debajo de la otra. Los rótulos dicen
 * de qué es cada dato («Nombre del restaurante», «Usuario para ingresar»).
 *
 * BL-472 (HU-042): quinta tarjeta, «Cola de pedidos», con la cola automática
 * del KDS apagada. Al encenderla propone el límite recomendado (5), que se
 * puede cambiar o descartar apagándola; el umbral de alerta y los minutos de
 * referencia quedan con sus valores por defecto.
 */
export function AltaEstablecimientoDialog({
  open,
  onClose,
  token,
  onCreado,
  completar = null,
}: Readonly<Props>) {
  const [form, setForm] = useState<FormularioAlta>(FORMULARIO_VACIO);
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [enviando, setEnviando] = useState(false);
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoAlta | null>(null);
  // BL-408: qué contraseñas se copiaron (usernames), el aviso para el lector
  // de pantalla y si se está pidiendo confirmación para cerrar sin copiar.
  const [copiadas, setCopiadas] = useState<ReadonlySet<string>>(new Set());
  const [avisoCopia, setAvisoCopia] = useState("");
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const botonVolver = useRef<HTMLButtonElement>(null);
  const completando = completar !== null;
  let textoBoton = completando ? "Completar alta" : "Dar de alta";
  if (enviando) textoBoton = completando ? "Completando…" : "Dando de alta…";

  // BL-407: al abrir, el formulario arranca vacío o con los datos del
  // establecimiento a completar.
  useEffect(() => {
    if (!open) return;
    setForm(completar ? formularioParaCompletar(completar) : FORMULARIO_VACIO);
    setErrores({});
    setErrorApi(null);
  }, [open, completar]);

  const cerrar = () => {
    // Al cerrar se descartan el formulario y las contraseñas mostradas.
    setForm(FORMULARIO_VACIO);
    setErrores({});
    setErrorApi(null);
    setResultado(null);
    setCopiadas(new Set());
    setAvisoCopia("");
    setConfirmandoCierre(false);
    onClose();
  };

  // BL-408: con contraseñas sin copiar, Esc, la X, el clic afuera y «Listo»
  // no cierran de una: piden confirmación (no se pueden volver a ver).
  const sinCopiar = resultado
    ? contrasenasSinCopiar(credencialesAMostrar(resultado), copiadas)
    : [];
  const intentarCerrar = () => {
    if (sinCopiar.length > 0 && !confirmandoCierre) {
      setConfirmandoCierre(true);
      return;
    }
    cerrar();
  };

  // Al pedir confirmación, el foco va a «Volver a las contraseñas», la opción
  // que no pierde nada.
  useEffect(() => {
    if (confirmandoCierre) botonVolver.current?.focus();
  }, [confirmandoCierre]);

  const volverALasContrasenas = () => {
    setConfirmandoCierre(false);
    // El foco vuelve al primer «Copiar» que falta.
    const pendiente = sinCopiar[0];
    if (pendiente) {
      requestAnimationFrame(() =>
        document.getElementById(`copiar-${pendiente}`)?.focus(),
      );
    }
  };

  const cambiar = (id: CampoTextoAlta, valor: string) => {
    setForm((prev) => ({ ...prev, [id]: valor }));
    if (errores[id]) setErrores((prev) => ({ ...prev, [id]: undefined }));
  };

  // BL-472: al apagar la cola se descarta el límite (el local queda sin
  // cola, como antes) y su error deja de importar.
  const cambiarCola = (activa: boolean) => {
    setForm((prev) => ({ ...prev, colaActiva: activa }));
    if (!activa && errores.colaLimite) {
      setErrores((prev) => ({ ...prev, colaLimite: undefined }));
    }
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const encontrados = validarFormulario(form);
    setErrores(encontrados);
    if (Object.keys(encontrados).length > 0) return;

    setEnviando(true);
    setErrorApi(null);
    try {
      const respuesta = await apiFetch<ResultadoAlta>(
        "/plataforma/establecimientos",
        token,
        {
          method: "POST",
          body: JSON.stringify(construirPedidoAlta(form)),
        },
      );
      setResultado(respuesta);
      onCreado(respuesta);
    } catch (err) {
      setErrorApi(
        err instanceof ApiError
          ? mensajeDeError(err.status, err.message)
          : "No se pudo dar de alta el establecimiento",
      );
    } finally {
      setEnviando(false);
    }
  };

  /**
   * BL-408: copia la contraseña y lo anuncia. Si el navegador no deja usar el
   * portapapeles (permiso denegado, página sin HTTPS), la deja seleccionada
   * para copiarla con Ctrl+C y lo avisa, en lugar de fallar en silencio.
   */
  const copiar = async (usuario: UsuarioAprovisionado) => {
    try {
      await navigator.clipboard.writeText(usuario.passwordGenerada ?? "");
      setCopiadas((prev) => new Set(prev).add(usuario.username));
      setAvisoCopia(avisoDeCopia(usuario.rol, true));
    } catch {
      const codigo = document.getElementById(`contrasena-${usuario.username}`);
      if (codigo) globalThis.getSelection()?.selectAllChildren(codigo);
      setAvisoCopia(avisoDeCopia(usuario.rol, false));
    }
  };

  if (resultado) {
    const credenciales = credencialesAMostrar(resultado);
    return (
      <Dialog
        open={open}
        onClose={intentarCerrar}
        title="Establecimiento listo"
        tamano="lg"
      >
        <div className="space-y-4">
          <p className="text-body-md text-on-surface">
            {resumirAlta(resultado)}
          </p>

          {credenciales.length > 0 && (
            <>
              <p className="rounded-lg bg-tertiary-fixed px-3 py-2 text-body-md text-on-tertiary-fixed">
                Estas contraseñas temporales{" "}
                <strong>solo se muestran ahora</strong>. Copialas y pasalas por
                la base KeePass del equipo, nunca por chat ni mail. Keycloak
                pide cambiarlas en el primer ingreso.
              </p>
              <ul className="space-y-2">
                {credenciales.map((u) => {
                  const copiada = copiadas.has(u.username);
                  return (
                    <li
                      key={u.username}
                      className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2"
                    >
                      <p className="text-body-md text-on-surface-variant">
                        {ETIQUETA_ROL[u.rol]} ·{" "}
                        <span className="font-semibold text-on-surface">
                          {u.username}
                        </span>
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <code
                          id={`contrasena-${u.username}`}
                          className="break-all text-body-md text-on-surface"
                        >
                          {u.passwordGenerada}
                        </code>
                        {/* El nombre accesible empieza con el texto visible
                            y dice de quién es la contraseña. */}
                        <button
                          id={`copiar-${u.username}`}
                          type="button"
                          onClick={() => copiar(u)}
                          aria-label={`${copiada ? "Copiada" : "Copiar"}: contraseña de ${ETIQUETA_ROL[u.rol]}`}
                          className="flex min-h-12 shrink-0 items-center gap-1 rounded-lg px-3 text-body-md font-semibold text-primary hover:bg-surface-container-high"
                        >
                          <span
                            className="material-symbols-outlined text-[20px]"
                            aria-hidden="true"
                          >
                            {copiada ? "check" : "content_copy"}
                          </span>
                          <span aria-hidden="true">
                            {copiada ? "Copiada" : "Copiar"}
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* BL-408: resultado de cada copia, para el lector de pantalla.
              Siempre en el DOM para que el cambio se anuncie. */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {avisoCopia}
          </p>

          {confirmandoCierre ? (
            <div
              role="alert"
              className="space-y-3 rounded-lg border border-error bg-error-container px-4 py-3 text-on-error-container"
            >
              <p className="text-body-md">
                <strong>
                  {sinCopiar.length === 1
                    ? "Hay una contraseña sin copiar."
                    : `Hay ${sinCopiar.length} contraseñas sin copiar.`}
                </strong>{" "}
                Si cerrás, no se pueden volver a ver: habría que restablecerlas.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={cerrar}
                  className={CLASE_BOTON_SECUNDARIO}
                >
                  Cerrar igual
                </button>
                <button
                  ref={botonVolver}
                  type="button"
                  onClick={volverALasContrasenas}
                  className={CLASE_BOTON_PRIMARIO}
                >
                  Volver a las contraseñas
                </button>
              </div>
            </div>
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

  return (
    <Dialog
      open={open}
      onClose={cerrar}
      title={completando ? "Completar alta" : "Nuevo establecimiento"}
      tamano="lg"
    >
      <form onSubmit={enviar} noValidate className="space-y-5">
        {completando && (
          <p className="rounded-lg bg-surface-container px-3 py-2 text-body-md text-on-surface">
            A este establecimiento le falta el restaurante. Cargá lo que falta:
            no se duplica nada. Si el Administrador o la Cocina ya existen, usá
            los mismos usuarios; no se les cambia la contraseña.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Seccion
            id="seccion-empresa"
            icono="domain"
            titulo="Empresa"
            descripcion="Datos fiscales del establecimiento: con estos se emiten los comprobantes."
          >
            <Campo
              id="razonSocial"
              label="Razón social"
              valor={form.razonSocial}
              error={errores.razonSocial}
              soloLectura={completando}
              onChange={cambiar}
            />
            <Campo
              id="rut"
              label="RUT"
              valor={form.rut}
              error={errores.rut}
              ayuda={
                completando
                  ? "Datos del establecimiento existente: no se cambian al completar el alta."
                  : "12 dígitos, con o sin puntos y guiones. Se controla el dígito verificador."
              }
              inputMode="numeric"
              soloLectura={completando}
              onChange={cambiar}
            />
          </Seccion>

          <Seccion
            id="seccion-restaurante"
            icono="storefront"
            titulo="Restaurante"
            descripcion="El local que ven los comensales en la carta y en el QR de las mesas."
          >
            <Campo
              id="restauranteNombre"
              label="Nombre del restaurante"
              valor={form.restauranteNombre}
              error={errores.restauranteNombre}
              enfocar={completando}
              onChange={cambiar}
            />
            <Campo
              id="restauranteDireccion"
              label="Dirección"
              valor={form.restauranteDireccion}
              error={errores.restauranteDireccion}
              onChange={cambiar}
            />
          </Seccion>

          <Seccion
            id="seccion-admin"
            icono="shield_person"
            titulo="Administrador"
            descripcion="La persona que gestiona el restaurante: carta, mesas y personal."
          >
            <Campo
              id="adminUsername"
              label="Usuario para ingresar"
              valor={form.adminUsername}
              error={errores.adminUsername}
              onChange={cambiar}
            />
            <Campo
              id="adminEmail"
              label="Correo"
              tipo="email"
              valor={form.adminEmail}
              error={errores.adminEmail}
              onChange={cambiar}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                id="adminNombre"
                label="Nombre"
                valor={form.adminNombre}
                error={errores.adminNombre}
                onChange={cambiar}
              />
              <Campo
                id="adminApellido"
                label="Apellido"
                valor={form.adminApellido}
                error={errores.adminApellido}
                onChange={cambiar}
              />
            </div>
          </Seccion>

          <Seccion
            id="seccion-cocina"
            icono="soup_kitchen"
            titulo="Cocina"
            descripcion="Cuenta compartida del monitor de pedidos: la usan todas las pantallas de la cocina."
          >
            <Campo
              id="cocinaUsername"
              label="Usuario para ingresar"
              valor={form.cocinaUsername}
              error={errores.cocinaUsername}
              onChange={cambiar}
            />
            <Campo
              id="cocinaEmail"
              label="Correo (opcional)"
              tipo="email"
              valor={form.cocinaEmail}
              error={errores.cocinaEmail}
              ayuda="Si lo dejás vacío, se usa uno técnico."
              onChange={cambiar}
            />
          </Seccion>

          {/* BL-472 (HU-042): la cola del KDS se sugiere en el alta, pero
              es opcional: arranca apagada. Ocupa el ancho de las dos
              columnas en PC. */}
          <div className="md:col-span-2">
            <Seccion
              id="seccion-cola"
              icono="format_list_numbered"
              titulo="Cola de pedidos (opcional)"
              descripcion="Limita cuántos pedidos prepara la cocina a la vez. Los demás esperan en orden de llegada y pasan a preparación solos cuando uno queda listo. Sirve para que la cocina no se sature en las horas pico."
            >
              <div className="flex min-h-12 items-center justify-between gap-4">
                <p className="text-body-md text-on-surface">
                  Cola automática de pedidos
                </p>
                <Switch
                  checked={form.colaActiva}
                  onChange={cambiarCola}
                  label="Cola automática de pedidos"
                  describedBy="seccion-cola-descripcion"
                />
              </div>
              {form.colaActiva ? (
                <Campo
                  id="colaLimite"
                  label="Pedidos en preparación a la vez"
                  valor={form.colaLimite}
                  error={errores.colaLimite}
                  ayuda={`Recomendado: ${LIMITE_PREPARACION_SUGERIDO}. Entre ${LIMITE_PREPARACION.minimo} y ${LIMITE_PREPARACION.maximo}. El Administrador lo puede cambiar después en Configuración → Cocina.`}
                  inputMode="numeric"
                  onChange={cambiar}
                />
              ) : (
                <p className="text-body-md text-on-surface-variant">
                  Apagada: el mozo pasa los pedidos a preparación a mano. El
                  Administrador la puede activar después en Configuración →
                  Cocina.
                </p>
              )}
            </Seccion>
          </div>
        </div>

        <p className="text-body-md text-on-surface-variant">
          Las contraseñas del Administrador y de Cocina las genera el sistema y
          se muestran una sola vez al terminar. El comensal técnico y la mesa
          virtual se crean solos.
        </p>

        {errorApi && (
          <p
            role="alert"
            className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container"
          >
            {errorApi}
          </p>
        )}

        {/* En el celular, el botón principal queda arriba y a todo el ancho. */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={cerrar}
            className={CLASE_BOTON_SECUNDARIO}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando}
            className={CLASE_BOTON_PRIMARIO}
          >
            {textoBoton}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
