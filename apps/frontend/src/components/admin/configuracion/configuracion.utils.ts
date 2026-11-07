/**
 * HU-020 (BL-72): configuración del establecimiento.
 * Lógica pura de la pantalla /admin/configuracion (probada en
 * test/unitarios/configuracion.utils.spec.ts).
 */

export type CfeProveedor = "SURTEC" | "BILLER";
export type MedioPago = "EFECTIVO" | "MERCADOPAGO" | "POS" | "PLEXO" | "HANDY";

/** Respuesta de GET y PATCH /admin/configuracion. */
export interface ConfiguracionEstablecimiento {
  razonSocial: string;
  /** Solo lectura: lo cambia el equipo de BistroLink (BL-412). */
  rut: string;
  efectivoHabilitado: boolean;
  mercadoPagoHabilitado: boolean;
  /**
   * HU-007b (BL-80): cobros con el POS del local. Opcional: un backend
   * anterior no lo trae.
   */
  posHabilitado?: boolean;
  plexoHabilitado: boolean;
  handyHabilitado: boolean;
  propinasSugeridas: number[];
  cfeProveedor: CfeProveedor;
  /** Los que se pueden habilitar hoy (Plexo y Handy, fuera del MVP). */
  mediosPagoDisponibles: MedioPago[];
  /** Los que se pueden elegir hoy (Biller, fuera del MVP). */
  proveedoresCfeDisponibles: CfeProveedor[];
  /**
   * HU-036 (BL-206): correo para los derechos sobre los datos personales.
   * Opcional en el tipo: un backend anterior no lo trae.
   */
  emailPrivacidad?: string | null;
  /**
   * HU-042 (BL-465): cola del KDS. null = desactivada. Opcionales en el tipo:
   * un backend anterior no los trae.
   */
  limitePedidosEnPreparacion?: number | null;
  umbralAlertaCola?: number;
  minutosPreparacionEstimados?: number;
}

export type CampoMedioPago =
  | "efectivoHabilitado"
  | "mercadoPagoHabilitado"
  | "posHabilitado"
  | "plexoHabilitado"
  | "handyHabilitado";

/** Lo que el administrador edita en la pantalla. */
export interface FormularioConfiguracion {
  razonSocial: string;
  efectivoHabilitado: boolean;
  mercadoPagoHabilitado: boolean;
  posHabilitado: boolean;
  plexoHabilitado: boolean;
  handyHabilitado: boolean;
  /** Texto del campo, por ejemplo «10, 15, 20». */
  propinas: string;
  cfeProveedor: CfeProveedor;
  /** HU-036 (BL-206): vacío = sin correo. */
  emailPrivacidad: string;
  /** HU-042 (BL-465): cola automática del KDS encendida. */
  colaActiva: boolean;
  /** Texto de los campos de la cola (se validan al guardar). */
  limitePreparacion: string;
  umbralAlertaCola: string;
  minutosPreparacion: string;
}

/** Body de PATCH /admin/configuracion: solo lo que cambió. */
export type CambiosConfiguracion = Partial<
  Omit<
    FormularioConfiguracion,
    | "propinas"
    | "emailPrivacidad"
    | "colaActiva"
    | "limitePreparacion"
    | "umbralAlertaCola"
    | "minutosPreparacion"
  >
> & {
  propinasSugeridas?: number[];
  emailPrivacidad?: string | null;
  limitePedidosEnPreparacion?: number | null;
  umbralAlertaCola?: number;
  minutosPreparacionEstimados?: number;
};

/** Mismos límites que el backend (ActualizarConfiguracionDto). */
export const MAXIMO_PROPINAS = 5;
export const PROPINA_MINIMA = 1;
export const PROPINA_MAXIMA = 100;
export const LARGO_MAXIMO_RAZON_SOCIAL = 200;
export const LARGO_MAXIMO_EMAIL = 254;

/** HU-042 (BL-465): rangos de la cola, los mismos que el backend. */
export const LIMITE_PREPARACION = { minimo: 1, maximo: 50 } as const;
export const UMBRAL_ALERTA_COLA = { minimo: 1, maximo: 200 } as const;
export const MINUTOS_PREPARACION = { minimo: 1, maximo: 180 } as const;
/** Valores que propone la pantalla al activar la cola por primera vez. */
export const LIMITE_PREPARACION_SUGERIDO = 5;
const UMBRAL_ALERTA_COLA_POR_DEFECTO = 10;
const MINUTOS_PREPARACION_POR_DEFECTO = 15;

export const MEDIOS_PAGO: ReadonlyArray<{
  codigo: MedioPago;
  campo: CampoMedioPago;
  nombre: string;
  descripcion: string;
}> = [
  {
    codigo: "EFECTIVO",
    campo: "efectivoHabilitado",
    nombre: "Efectivo",
    descripcion: "El mozo registra el cobro desde «Cobros pendientes».",
  },
  {
    codigo: "MERCADOPAGO",
    campo: "mercadoPagoHabilitado",
    nombre: "Mercado Pago",
    descripcion: "El comensal paga con tarjeta desde su celular.",
  },
  {
    codigo: "POS",
    campo: "posHabilitado",
    nombre: "POS del local",
    descripcion:
      "El mozo cobra con el POS del local y registra el cobro desde «Cobros pendientes».",
  },
  {
    codigo: "PLEXO",
    campo: "plexoHabilitado",
    nombre: "Plexo",
    descripcion: "Pago con Plexo.",
  },
  {
    codigo: "HANDY",
    campo: "handyHabilitado",
    nombre: "Handy",
    descripcion: "Pago con Handy.",
  },
];

export const PROVEEDORES_CFE: ReadonlyArray<{
  codigo: CfeProveedor;
  nombre: string;
}> = [
  { codigo: "SURTEC", nombre: "Surtec" },
  { codigo: "BILLER", nombre: "Biller" },
];

export function formularioDesde(
  configuracion: ConfiguracionEstablecimiento,
): FormularioConfiguracion {
  return {
    razonSocial: configuracion.razonSocial,
    efectivoHabilitado: configuracion.efectivoHabilitado,
    mercadoPagoHabilitado: configuracion.mercadoPagoHabilitado,
    // Un backend anterior no lo trae: queda como el default de la columna.
    posHabilitado: configuracion.posHabilitado ?? true,
    plexoHabilitado: configuracion.plexoHabilitado,
    handyHabilitado: configuracion.handyHabilitado,
    propinas: textoDePropinas(configuracion.propinasSugeridas),
    cfeProveedor: configuracion.cfeProveedor,
    emailPrivacidad: configuracion.emailPrivacidad ?? "",
    colaActiva: configuracion.limitePedidosEnPreparacion != null,
    limitePreparacion: String(
      configuracion.limitePedidosEnPreparacion ?? LIMITE_PREPARACION_SUGERIDO,
    ),
    umbralAlertaCola: String(
      configuracion.umbralAlertaCola ?? UMBRAL_ALERTA_COLA_POR_DEFECTO,
    ),
    minutosPreparacion: String(
      configuracion.minutosPreparacionEstimados ??
        MINUTOS_PREPARACION_POR_DEFECTO,
    ),
  };
}

/**
 * HU-042 (BL-465): lee un número entero dentro de un rango. Devuelve el
 * número o el error a mostrar.
 */
function leerEntero(
  texto: string,
  { minimo, maximo }: { minimo: number; maximo: number },
): { valor: number } | { error: string } {
  const limpio = texto.trim();
  if (!/^\d+$/.test(limpio)) {
    return { error: "Escribí un número entero." };
  }
  const valor = Number(limpio);
  if (valor < minimo || valor > maximo) {
    return { error: `Tiene que estar entre ${minimo} y ${maximo}.` };
  }
  return { valor };
}

/** HU-042 (BL-465): errores de los campos de la cola (solo con la cola activa). */
export interface ErroresCola {
  limitePreparacion?: string;
  umbralAlertaCola?: string;
  minutosPreparacion?: string;
}

export function erroresCola(formulario: FormularioConfiguracion): ErroresCola {
  if (!formulario.colaActiva) return {};
  const errores: ErroresCola = {};
  const limite = leerEntero(formulario.limitePreparacion, LIMITE_PREPARACION);
  if ("error" in limite) errores.limitePreparacion = limite.error;
  const umbral = leerEntero(formulario.umbralAlertaCola, UMBRAL_ALERTA_COLA);
  if ("error" in umbral) errores.umbralAlertaCola = umbral.error;
  const minutos = leerEntero(
    formulario.minutosPreparacion,
    MINUTOS_PREPARACION,
  );
  if ("error" in minutos) errores.minutosPreparacion = minutos.error;
  return errores;
}

export function hayErroresCola(errores: ErroresCola): boolean {
  return Object.keys(errores).length > 0;
}

/** Errores de cada campo del formulario (null = sin error). */
export interface ErroresFormulario {
  razonSocial: string | null;
  propinas: string | null;
  email: string | null;
  cola: ErroresCola;
}

/**
 * Valida todo el formulario de una vez. Sin formulario (todavía cargando),
 * no hay errores.
 */
export function erroresDelFormulario(
  formulario: FormularioConfiguracion | null,
): ErroresFormulario {
  if (!formulario) {
    return { razonSocial: null, propinas: null, email: null, cola: {} };
  }
  const propinas = leerPropinas(formulario.propinas);
  return {
    razonSocial: errorRazonSocial(formulario.razonSocial),
    propinas: "error" in propinas ? propinas.error : null,
    email: errorEmailPrivacidad(formulario.emailPrivacidad),
    cola: erroresCola(formulario),
  };
}

/**
 * Id del primer campo con error, en el orden de la pantalla, para llevarle el
 * foco al guardar. null si no hay errores.
 */
export function primerCampoConError(errores: ErroresFormulario): string | null {
  const enOrden: [string, unknown][] = [
    ["razon-social", errores.razonSocial],
    ["propinas", errores.propinas],
    ["cola-limite", errores.cola.limitePreparacion],
    ["cola-umbral", errores.cola.umbralAlertaCola],
    ["cola-minutos", errores.cola.minutosPreparacion],
    ["email-privacidad", errores.email],
  ];
  return enOrden.find(([, error]) => Boolean(error))?.[0] ?? null;
}

/**
 * HU-042 (BL-465): cambios de la cola para el PATCH. Apagarla manda el
 * límite en null (el umbral y los minutos quedan guardados para la próxima
 * vez). Supone que pasó erroresCola.
 */
function cambiosDeLaCola(
  guardada: ConfiguracionEstablecimiento,
  formulario: FormularioConfiguracion,
): Partial<CambiosConfiguracion> {
  const limiteGuardado = guardada.limitePedidosEnPreparacion ?? null;
  if (!formulario.colaActiva) {
    return limiteGuardado === null ? {} : { limitePedidosEnPreparacion: null };
  }
  const cambios: Partial<CambiosConfiguracion> = {};
  const limite = Number(formulario.limitePreparacion.trim());
  if (limite !== limiteGuardado) cambios.limitePedidosEnPreparacion = limite;
  const umbral = Number(formulario.umbralAlertaCola.trim());
  if (
    umbral !== (guardada.umbralAlertaCola ?? UMBRAL_ALERTA_COLA_POR_DEFECTO)
  ) {
    cambios.umbralAlertaCola = umbral;
  }
  const minutos = Number(formulario.minutosPreparacion.trim());
  if (
    minutos !==
    (guardada.minutosPreparacionEstimados ?? MINUTOS_PREPARACION_POR_DEFECTO)
  ) {
    cambios.minutosPreparacionEstimados = minutos;
  }
  return cambios;
}

export function textoDePropinas(propinas: number[]): string {
  return propinas.join(", ");
}

/**
 * Lee el campo de propinas: números enteros separados por comas o espacios.
 * Vacío = sin sugerencias. Devuelve la lista ordenada o el error a mostrar.
 */
export function leerPropinas(
  texto: string,
): { propinas: number[] } | { error: string } {
  const partes = texto
    .split(/[\s,;]+/)
    .map((p) => p.replace(/%$/, ""))
    .filter((p) => p !== "");
  if (partes.length === 0) return { propinas: [] };
  if (partes.some((p) => !/^\d+$/.test(p))) {
    return {
      error:
        "Escribí porcentajes enteros separados por comas, como 10, 15, 20.",
    };
  }
  const propinas = partes.map(Number);
  if (propinas.some((p) => p < PROPINA_MINIMA || p > PROPINA_MAXIMA)) {
    return {
      error: `Cada porcentaje tiene que estar entre ${PROPINA_MINIMA} y ${PROPINA_MAXIMA}.`,
    };
  }
  if (new Set(propinas).size !== propinas.length) {
    return { error: "No repitas porcentajes." };
  }
  if (propinas.length > MAXIMO_PROPINAS) {
    return { error: `Podés sugerir hasta ${MAXIMO_PROPINAS} porcentajes.` };
  }
  return { propinas: [...propinas].sort((a, b) => a - b) };
}

/** Error de la razón social, o null si está bien. */
export function errorRazonSocial(razonSocial: string): string | null {
  const limpia = razonSocial.trim();
  if (limpia === "") return "La razón social es obligatoria.";
  if (limpia.length > LARGO_MAXIMO_RAZON_SOCIAL) {
    return `La razón social puede tener hasta ${LARGO_MAXIMO_RAZON_SOCIAL} caracteres.`;
  }
  return null;
}

/** HU-036 (BL-206): sin espacios y en minúsculas; vacío = null. */
function normalizarEmail(email: string): string | null {
  const limpio = email.trim().toLowerCase();
  return limpio === "" ? null : limpio;
}

/**
 * HU-036 (BL-206): error del correo de privacidad, o null si está bien. Es
 * opcional (vacío vale). Mismo control básico que el backend; el detalle lo
 * valida la API.
 */
export function errorEmailPrivacidad(email: string): string | null {
  const limpio = email.trim();
  if (limpio === "") return null;
  if (limpio.length > LARGO_MAXIMO_EMAIL) {
    return `El correo puede tener hasta ${LARGO_MAXIMO_EMAIL} caracteres.`;
  }
  return pareceEmail(limpio)
    ? null
    : "Revisá el correo: por ejemplo, privacidad@tulocal.com.uy.";
}

/**
 * Una sola arroba, algo antes, y un dominio con un punto que no esté ni al
 * principio ni al final; sin espacios. Sin una expresión regular compuesta,
 * para no tener backtracking (Sonar S8786).
 */
function pareceEmail(email: string): boolean {
  if (/\s/.test(email)) return false;
  const partes = email.split("@");
  if (partes.length !== 2) return false;
  const [usuario, dominio] = partes;
  const punto = dominio.lastIndexOf(".");
  return usuario.length > 0 && punto > 0 && punto < dominio.length - 1;
}

/**
 * Lo que hay que mandar en el PATCH: solo los campos que cambiaron respecto
 * de lo guardado. Vacío si no cambió nada. Supone que el formulario ya pasó
 * las validaciones (leerPropinas, errorRazonSocial, errorEmailPrivacidad y
 * erroresCola).
 */
export function cambiosParaGuardar(
  guardada: ConfiguracionEstablecimiento,
  formulario: FormularioConfiguracion,
): CambiosConfiguracion {
  const cambios: CambiosConfiguracion = {};
  const razonSocial = formulario.razonSocial.trim().replace(/\s+/g, " ");
  if (razonSocial !== guardada.razonSocial) cambios.razonSocial = razonSocial;
  for (const { campo } of MEDIOS_PAGO) {
    const guardado =
      guardada[campo] ?? (campo === "posHabilitado" ? true : false);
    if (formulario[campo] !== guardado) cambios[campo] = formulario[campo];
  }
  const lectura = leerPropinas(formulario.propinas);
  if (
    "propinas" in lectura &&
    lectura.propinas.join(",") !== guardada.propinasSugeridas.join(",")
  ) {
    cambios.propinasSugeridas = lectura.propinas;
  }
  if (formulario.cfeProveedor !== guardada.cfeProveedor) {
    cambios.cfeProveedor = formulario.cfeProveedor;
  }
  const email = normalizarEmail(formulario.emailPrivacidad);
  if (email !== (guardada.emailPrivacidad ?? null)) {
    cambios.emailPrivacidad = email;
  }
  return { ...cambios, ...cambiosDeLaCola(guardada, formulario) };
}

export function hayCambios(cambios: CambiosConfiguracion): boolean {
  return Object.keys(cambios).length > 0;
}

/** Ningún medio habilitado: el local no podría cobrar. */
export function sinMediosDePago(formulario: FormularioConfiguracion): boolean {
  return MEDIOS_PAGO.every(({ campo }) => !formulario[campo]);
}

// ── HU-009 (BL-453): anonimizar los datos de la e-Factura de un comensal ──

/** POST: anonimiza el RUT y la razón social en los pedidos con ese RUT. */
export const RUTA_ANONIMIZAR_RECEPTOR =
  "/admin/configuracion/privacidad/anonimizar-receptor";

/** Respuesta del POST: cuántos pedidos tenían ese RUT. */
export interface ResultadoAnonimizacion {
  pedidos: number;
}

/** Mensaje para el administrador después de anonimizar. */
export function mensajeAnonimizacion({
  pedidos,
}: ResultadoAnonimizacion): string {
  if (pedidos === 0) {
    return "No hay pedidos con ese RUT: no había datos para anonimizar.";
  }
  return pedidos === 1
    ? "Listo: se anonimizó 1 pedido."
    : `Listo: se anonimizaron ${pedidos} pedidos.`;
}
