/**
 * HU-020 (BL-72): configuración del establecimiento.
 * Lógica pura de la pantalla /admin/configuracion (probada en
 * test/unitarios/configuracion.utils.spec.ts).
 */

export type CfeProveedor = "SURTEC" | "BILLER";
export type MedioPago = "EFECTIVO" | "MERCADOPAGO" | "PLEXO" | "HANDY";

/** Respuesta de GET y PATCH /admin/configuracion. */
export interface ConfiguracionEstablecimiento {
  razonSocial: string;
  /** Solo lectura: lo cambia el equipo de BistroLink (BL-412). */
  rut: string;
  efectivoHabilitado: boolean;
  mercadoPagoHabilitado: boolean;
  plexoHabilitado: boolean;
  handyHabilitado: boolean;
  propinasSugeridas: number[];
  cfeProveedor: CfeProveedor;
  /** Los que se pueden habilitar hoy (Handy, fuera del MVP). */
  mediosPagoDisponibles: MedioPago[];
  /** Los que se pueden elegir hoy (Biller, fuera del MVP). */
  proveedoresCfeDisponibles: CfeProveedor[];
}

export type CampoMedioPago =
  | "efectivoHabilitado"
  | "mercadoPagoHabilitado"
  | "plexoHabilitado"
  | "handyHabilitado";

/** Lo que el administrador edita en la pantalla. */
export interface FormularioConfiguracion {
  razonSocial: string;
  efectivoHabilitado: boolean;
  mercadoPagoHabilitado: boolean;
  plexoHabilitado: boolean;
  handyHabilitado: boolean;
  /** Texto del campo, por ejemplo «10, 15, 20». */
  propinas: string;
  cfeProveedor: CfeProveedor;
}

/** Body de PATCH /admin/configuracion: solo lo que cambió. */
export type CambiosConfiguracion = Partial<
  Omit<FormularioConfiguracion, "propinas">
> & { propinasSugeridas?: number[] };

/** Mismos límites que el backend (ActualizarConfiguracionDto). */
export const MAXIMO_PROPINAS = 5;
export const PROPINA_MINIMA = 1;
export const PROPINA_MAXIMA = 100;
export const LARGO_MAXIMO_RAZON_SOCIAL = 200;

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
    codigo: "PLEXO",
    campo: "plexoHabilitado",
    nombre: "Plexo",
    descripcion: "El comensal paga en el checkout de Plexo.",
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
    plexoHabilitado: configuracion.plexoHabilitado,
    handyHabilitado: configuracion.handyHabilitado,
    propinas: textoDePropinas(configuracion.propinasSugeridas),
    cfeProveedor: configuracion.cfeProveedor,
  };
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

/**
 * Lo que hay que mandar en el PATCH: solo los campos que cambiaron respecto
 * de lo guardado. Vacío si no cambió nada. Supone que el formulario ya pasó
 * las validaciones (leerPropinas y errorRazonSocial).
 */
export function cambiosParaGuardar(
  guardada: ConfiguracionEstablecimiento,
  formulario: FormularioConfiguracion,
): CambiosConfiguracion {
  const cambios: CambiosConfiguracion = {};
  const razonSocial = formulario.razonSocial.trim().replace(/\s+/g, " ");
  if (razonSocial !== guardada.razonSocial) cambios.razonSocial = razonSocial;
  for (const { campo } of MEDIOS_PAGO) {
    if (formulario[campo] !== guardada[campo])
      cambios[campo] = formulario[campo];
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
  return cambios;
}

export function hayCambios(cambios: CambiosConfiguracion): boolean {
  return Object.keys(cambios).length > 0;
}

/** Ningún medio habilitado: el local no podría cobrar. */
export function sinMediosDePago(formulario: FormularioConfiguracion): boolean {
  return MEDIOS_PAGO.every(({ campo }) => !formulario[campo]);
}
