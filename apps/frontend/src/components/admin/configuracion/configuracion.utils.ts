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
  /**
   * HU-022 (BL-495): marcar el 10 % en la pantalla de pago del comensal.
   * Opcional en el tipo: un backend anterior no lo trae (vale false).
   */
  propinaPreseleccionada?: boolean;
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
  /**
   * HU-038 (BL-506): umbrales de espera de las comandas del KDS, en minutos.
   * Opcionales en el tipo: un backend anterior no los trae.
   */
  minutosEsperaAtencion?: number;
  minutosEsperaDemorado?: number;
  minutosEsperaDemoraAlta?: number;
  /**
   * HU-040 (BL-210): pedidos para retirar por el enlace web, y la franja del
   * día en que se toman (null = todo el día). Opcionales: un backend
   * anterior no los trae.
   */
  retiroHabilitado?: boolean;
  retiroHoraDesde?: string | null;
  retiroHoraHasta?: string | null;
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
  /** Texto del campo, por ejemplo «5, 10, 15». */
  propinas: string;
  /** HU-022 (BL-495): preseleccionar el 10 % para el comensal. */
  propinaPreseleccionada: boolean;
  cfeProveedor: CfeProveedor;
  /** HU-036 (BL-206): vacío = sin correo. */
  emailPrivacidad: string;
  /** HU-042 (BL-465): cola automática del KDS encendida. */
  colaActiva: boolean;
  /** Texto de los campos de la cola (se validan al guardar). */
  limitePreparacion: string;
  umbralAlertaCola: string;
  minutosPreparacion: string;
  /** HU-038 (BL-506): texto de los umbrales de espera (se validan al guardar). */
  esperaAtencion: string;
  esperaDemorado: string;
  esperaDemoraAlta: string;
  /** HU-040 (BL-210): se toman pedidos para retirar. */
  retiroHabilitado: boolean;
  /** HU-040 (BL-210): «HH:MM» o vacío; las dos vacías = todo el día. */
  retiroHoraDesde: string;
  retiroHoraHasta: string;
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
    | "esperaAtencion"
    | "esperaDemorado"
    | "esperaDemoraAlta"
    | "retiroHoraDesde"
    | "retiroHoraHasta"
  >
> & {
  propinasSugeridas?: number[];
  emailPrivacidad?: string | null;
  limitePedidosEnPreparacion?: number | null;
  umbralAlertaCola?: number;
  minutosPreparacionEstimados?: number;
  minutosEsperaAtencion?: number;
  minutosEsperaDemorado?: number;
  minutosEsperaDemoraAlta?: number;
  retiroHoraDesde?: string | null;
  retiroHoraHasta?: string | null;
};

/** Mismos límites que el backend (ActualizarConfiguracionDto). */
export const MAXIMO_PROPINAS = 5;
export const PROPINA_MINIMA = 1;
export const PROPINA_MAXIMA = 100;
export const LARGO_MAXIMO_RAZON_SOCIAL = 200;
export const LARGO_MAXIMO_EMAIL = 254;

/** HU-022 (BL-495): el porcentaje que se marca si el local activa la opción. */
export const PORCENTAJE_PRESELECCIONADO = 10;

/** HU-042 (BL-465): rangos de la cola, los mismos que el backend. */
export const LIMITE_PREPARACION = { minimo: 1, maximo: 50 } as const;
export const UMBRAL_ALERTA_COLA = { minimo: 1, maximo: 200 } as const;
export const MINUTOS_PREPARACION = { minimo: 1, maximo: 180 } as const;
/** Valores que propone la pantalla al activar la cola por primera vez. */
export const LIMITE_PREPARACION_SUGERIDO = 5;
const UMBRAL_ALERTA_COLA_POR_DEFECTO = 10;
const MINUTOS_PREPARACION_POR_DEFECTO = 15;

/**
 * HU-038 (BL-506): rango de los umbrales de espera, el mismo que el backend.
 * Los valores por defecto son los del tablero (espera-kds.utils.ts).
 */
export const MINUTOS_ESPERA = { minimo: 1, maximo: 600 } as const;
const ESPERA_POR_DEFECTO = { atencion: 30, demorado: 60, demoraAlta: 120 };

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
    // HU-022 (BL-495): un backend anterior no lo trae: apagada, como el default.
    propinaPreseleccionada: configuracion.propinaPreseleccionada ?? false,
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
    esperaAtencion: String(
      configuracion.minutosEsperaAtencion ?? ESPERA_POR_DEFECTO.atencion,
    ),
    esperaDemorado: String(
      configuracion.minutosEsperaDemorado ?? ESPERA_POR_DEFECTO.demorado,
    ),
    esperaDemoraAlta: String(
      configuracion.minutosEsperaDemoraAlta ?? ESPERA_POR_DEFECTO.demoraAlta,
    ),
    // Un backend anterior no lo trae: queda como el default de la columna.
    retiroHabilitado: configuracion.retiroHabilitado ?? true,
    retiroHoraDesde: configuracion.retiroHoraDesde ?? "",
    retiroHoraHasta: configuracion.retiroHoraHasta ?? "",
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

/**
 * Errores de la sección «Cocina»: los de la cola (HU-042, BL-465: solo con la
 * cola activa) y los de los umbrales de espera (HU-038, BL-506: siempre).
 */
export interface ErroresCola {
  limitePreparacion?: string;
  umbralAlertaCola?: string;
  minutosPreparacion?: string;
  esperaAtencion?: string;
  esperaDemorado?: string;
  esperaDemoraAlta?: string;
}

/**
 * HU-038 (BL-506): cada umbral, entero dentro del rango; y, si los tres están
 * bien, de menor a mayor. El error de orden va en el campo que lo rompe.
 */
function erroresEspera(formulario: FormularioConfiguracion): ErroresCola {
  const errores: ErroresCola = {};
  const atencion = leerEntero(formulario.esperaAtencion, MINUTOS_ESPERA);
  if ("error" in atencion) errores.esperaAtencion = atencion.error;
  const demorado = leerEntero(formulario.esperaDemorado, MINUTOS_ESPERA);
  if ("error" in demorado) errores.esperaDemorado = demorado.error;
  const demoraAlta = leerEntero(formulario.esperaDemoraAlta, MINUTOS_ESPERA);
  if ("error" in demoraAlta) errores.esperaDemoraAlta = demoraAlta.error;
  if ("error" in atencion || "error" in demorado || "error" in demoraAlta) {
    return errores;
  }
  if (demorado.valor <= atencion.valor) {
    errores.esperaDemorado = "Tiene que ser mayor que «Atención desde».";
  } else if (demoraAlta.valor <= demorado.valor) {
    errores.esperaDemoraAlta = "Tiene que ser mayor que «Demorado desde».";
  }
  return errores;
}

export function erroresCola(formulario: FormularioConfiguracion): ErroresCola {
  if (!formulario.colaActiva) return erroresEspera(formulario);
  const errores: ErroresCola = erroresEspera(formulario);
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

/** HU-040 (BL-210): «HH:MM» de 00:00 a 23:59. */
const HORA_HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * HU-040 (BL-210): error del horario de los pedidos para retirar, o null.
 * Las dos horas vacías = todo el día; si no, las dos, válidas y distintas
 * (si «hasta» es menor que «desde», la franja cruza la medianoche).
 */
export function errorHorarioRetiro(
  formulario: Pick<
    FormularioConfiguracion,
    "retiroHoraDesde" | "retiroHoraHasta"
  >,
): string | null {
  const desde = formulario.retiroHoraDesde.trim();
  const hasta = formulario.retiroHoraHasta.trim();
  if (!desde && !hasta) return null;
  if (!desde || !hasta) {
    return "Completá las dos horas, o dejá las dos vacías para tomar pedidos todo el día.";
  }
  if (!HORA_HH_MM.test(desde) || !HORA_HH_MM.test(hasta)) {
    return "Escribí las horas como 11:00 o 23:30.";
  }
  if (desde === hasta) {
    return "La hora de inicio y la de cierre tienen que ser distintas.";
  }
  return null;
}

/** Errores de cada campo del formulario (null = sin error). */
export interface ErroresFormulario {
  razonSocial: string | null;
  propinas: string | null;
  email: string | null;
  cola: ErroresCola;
  /** HU-040 (BL-210). */
  retiro: string | null;
}

/**
 * Valida todo el formulario de una vez. Sin formulario (todavía cargando),
 * no hay errores.
 */
export function erroresDelFormulario(
  formulario: FormularioConfiguracion | null,
): ErroresFormulario {
  if (!formulario) {
    return {
      razonSocial: null,
      propinas: null,
      email: null,
      cola: {},
      retiro: null,
    };
  }
  const propinas = leerPropinas(formulario.propinas);
  return {
    razonSocial: errorRazonSocial(formulario.razonSocial),
    propinas: "error" in propinas ? propinas.error : null,
    email: errorEmailPrivacidad(formulario.emailPrivacidad),
    cola: erroresCola(formulario),
    retiro: errorHorarioRetiro(formulario),
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
    ["espera-atencion", errores.cola.esperaAtencion],
    ["espera-demorado", errores.cola.esperaDemorado],
    ["espera-demora-alta", errores.cola.esperaDemoraAlta],
    ["retiro-desde", errores.retiro],
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

/**
 * HU-038 (BL-506): cambios de los umbrales de espera para el PATCH, solo los
 * que cambiaron. No dependen de la cola. Supone que pasó erroresCola.
 */
function cambiosDeLaEspera(
  guardada: ConfiguracionEstablecimiento,
  formulario: FormularioConfiguracion,
): Partial<CambiosConfiguracion> {
  const cambios: Partial<CambiosConfiguracion> = {};
  const atencion = Number(formulario.esperaAtencion.trim());
  if (
    atencion !== (guardada.minutosEsperaAtencion ?? ESPERA_POR_DEFECTO.atencion)
  ) {
    cambios.minutosEsperaAtencion = atencion;
  }
  const demorado = Number(formulario.esperaDemorado.trim());
  if (
    demorado !== (guardada.minutosEsperaDemorado ?? ESPERA_POR_DEFECTO.demorado)
  ) {
    cambios.minutosEsperaDemorado = demorado;
  }
  const demoraAlta = Number(formulario.esperaDemoraAlta.trim());
  if (
    demoraAlta !==
    (guardada.minutosEsperaDemoraAlta ?? ESPERA_POR_DEFECTO.demoraAlta)
  ) {
    cambios.minutosEsperaDemoraAlta = demoraAlta;
  }
  return cambios;
}

/**
 * HU-040 (BL-210): cambios del retiro para el PATCH. Las horas van juntas
 * (el backend pide las dos o ninguna). Supone que pasó errorHorarioRetiro.
 */
function cambiosDelRetiro(
  guardada: ConfiguracionEstablecimiento,
  formulario: FormularioConfiguracion,
): Partial<CambiosConfiguracion> {
  const cambios: Partial<CambiosConfiguracion> = {};
  if (formulario.retiroHabilitado !== (guardada.retiroHabilitado ?? true)) {
    cambios.retiroHabilitado = formulario.retiroHabilitado;
  }
  const desde = formulario.retiroHoraDesde.trim() || null;
  const hasta = formulario.retiroHoraHasta.trim() || null;
  if (
    desde !== (guardada.retiroHoraDesde ?? null) ||
    hasta !== (guardada.retiroHoraHasta ?? null)
  ) {
    cambios.retiroHoraDesde = desde;
    cambios.retiroHoraHasta = hasta;
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
      error: "Escribí porcentajes enteros separados por comas, como 5, 10, 15.",
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

/**
 * HU-022 (BL-495): aviso cuando la preselección está activa pero el 10 % no
 * está entre los porcentajes sugeridos (entonces no se marca nada). No
 * bloquea el guardado. Si el campo de porcentajes tiene un error, no avisa:
 * ese error ya se muestra en su campo.
 */
export function avisoPreseleccion(
  formulario: FormularioConfiguracion,
): string | null {
  if (!formulario.propinaPreseleccionada) return null;
  const lectura = leerPropinas(formulario.propinas);
  if ("error" in lectura) return null;
  if (lectura.propinas.includes(PORCENTAJE_PRESELECCIONADO)) return null;
  return `El ${PORCENTAJE_PRESELECCIONADO} % no está en tus porcentajes sugeridos: mientras no lo agregues, no se va a marcar ninguna propina.`;
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
    // Un backend anterior no trae posHabilitado: vale el default (true).
    const guardado = guardada[campo] ?? campo === "posHabilitado";
    if (formulario[campo] !== guardado) cambios[campo] = formulario[campo];
  }
  const lectura = leerPropinas(formulario.propinas);
  if (
    "propinas" in lectura &&
    lectura.propinas.join(",") !== guardada.propinasSugeridas.join(",")
  ) {
    cambios.propinasSugeridas = lectura.propinas;
  }
  // HU-022 (BL-495): un backend anterior no lo trae: vale el default (false).
  if (
    formulario.propinaPreseleccionada !==
    (guardada.propinaPreseleccionada ?? false)
  ) {
    cambios.propinaPreseleccionada = formulario.propinaPreseleccionada;
  }
  if (formulario.cfeProveedor !== guardada.cfeProveedor) {
    cambios.cfeProveedor = formulario.cfeProveedor;
  }
  const email = normalizarEmail(formulario.emailPrivacidad);
  if (email !== (guardada.emailPrivacidad ?? null)) {
    cambios.emailPrivacidad = email;
  }
  return {
    ...cambios,
    ...cambiosDeLaCola(guardada, formulario),
    ...cambiosDeLaEspera(guardada, formulario),
    ...cambiosDelRetiro(guardada, formulario),
  };
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
export function mensajeAnonimizacion(
  resultado: ResultadoAnonimizacion,
): string {
  return mensajeDeAnonimizados(resultado, "ese RUT");
}

/** «Listo: se anonimizaron N pedidos» o que no había pedidos con ese dato. */
function mensajeDeAnonimizados(
  { pedidos }: ResultadoAnonimizacion,
  dato: string,
): string {
  if (pedidos === 0) {
    return `No hay pedidos con ${dato}: no había datos para anonimizar.`;
  }
  return pedidos === 1
    ? "Listo: se anonimizó 1 pedido."
    : `Listo: se anonimizaron ${pedidos} pedidos.`;
}

// ── HU-040 (BL-210): anonimizar el contacto de un pedido para retirar ──

/** POST: borra el nombre y el contacto en los pedidos con ese contacto. */
export const RUTA_ANONIMIZAR_RETIRO =
  "/admin/configuracion/privacidad/anonimizar-retiro";

/** Mensaje para el administrador después de anonimizar el contacto. */
export function mensajeAnonimizacionRetiro(
  resultado: ResultadoAnonimizacion,
): string {
  return mensajeDeAnonimizados(resultado, "ese contacto");
}
