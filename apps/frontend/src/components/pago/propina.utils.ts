/**
 * HU-022 (BL-495): lógica pura de la propina en la pantalla de pago del
 * comensal, separada de los componentes para poder testearla.
 *
 * El monto de la propina NUNCA se manda al backend (BL-90): el comensal elige
 * un porcentaje o un monto libre, el backend lo guarda en el pedido y calcula
 * lo que se cobra. Acá se calcula lo mismo solo para mostrarlo antes de
 * guardar, con el mismo redondeo que el backend (totales-pedido.ts): al peso,
 * con .5 hacia arriba, y sin pasar el consumo.
 */
import { MENSAJE_SIN_ACCESO, formatearPrecio } from "./pago.utils";

/** Porcentaje que se marca si el local activa la preselección (HU-020). */
export const PORCENTAJE_PRESELECCIONADO = 10;

export const MENSAJE_ERROR_PROPINA =
  "No pudimos guardar la propina. Probá de nuevo.";
export const MENSAJE_MONTO_PROPINA_INVALIDO =
  "Escribí un monto en pesos, sin centavos.";

/** Parte de GET .../pagos: lo que el pedido tiene guardado. */
export interface TotalesDelPedido {
  consumo: string;
  propina: string;
  total: string;
  propinaPorcentaje: number | null;
  propinaMonto: number | null;
}

/** Parte de GET .../pagos: lo que el local ofrece (HU-020 y BL-495). */
export interface PropinaDelLocal {
  sugeridas: number[];
  preseleccionada: boolean;
}

export type EleccionPropina =
  | { tipo: "ninguna" }
  | { tipo: "porcentaje"; porcentaje: number }
  | { tipo: "monto"; monto: number };

export const SIN_PROPINA: EleccionPropina = { tipo: "ninguna" };

/** Pesos con hasta 2 decimales, en centésimos enteros (sin errores de coma flotante). */
function aCentesimos(valor: number | string): number {
  return Math.round(Number(valor) * 100);
}

/** Tope de la propina: el consumo en pesos enteros, hacia abajo. */
export function topeDePropina(consumo: number | string): number {
  return Math.floor(aCentesimos(consumo) / 100);
}

/**
 * Propina en pesos enteros para un consumo y una elección. Porcentaje:
 * redondeado al peso con .5 hacia arriba (15 % de 1250 = 187,5 → 188).
 */
export function montoDePropina(
  consumo: number | string,
  eleccion: EleccionPropina,
): number {
  const tope = topeDePropina(consumo);
  if (eleccion.tipo === "porcentaje") {
    const pesos = Math.floor(
      (aCentesimos(consumo) * eleccion.porcentaje + 5000) / 10000,
    );
    return Math.min(pesos, tope);
  }
  if (eleccion.tipo === "monto") return Math.min(eleccion.monto, tope);
  return 0;
}

/** Consumo más propina, en pesos. */
export function totalConPropina(
  consumo: number | string,
  eleccion: EleccionPropina,
): number {
  return (
    (aCentesimos(consumo) + montoDePropina(consumo, eleccion) * 100) / 100
  );
}

export interface OpcionPropina {
  porcentaje: number;
  monto: number;
}

/** Una tarjeta por porcentaje sugerido, con su monto en pesos. */
export function opcionesDePropina(
  consumo: number | string,
  sugeridas: readonly number[],
): OpcionPropina[] {
  return sugeridas.map((porcentaje) => ({
    porcentaje,
    monto: montoDePropina(consumo, { tipo: "porcentaje", porcentaje }),
  }));
}

/** Lo que el pedido tiene guardado (porcentaje o monto; ninguno = sin propina). */
export function eleccionGuardada(totales: TotalesDelPedido): EleccionPropina {
  if (totales.propinaPorcentaje !== null) {
    return { tipo: "porcentaje", porcentaje: totales.propinaPorcentaje };
  }
  if (totales.propinaMonto !== null) {
    return { tipo: "monto", monto: totales.propinaMonto };
  }
  return SIN_PROPINA;
}

export function mismaEleccion(a: EleccionPropina, b: EleccionPropina): boolean {
  if (a.tipo === "porcentaje" && b.tipo === "porcentaje") {
    return a.porcentaje === b.porcentaje;
  }
  if (a.tipo === "monto" && b.tipo === "monto") return a.monto === b.monto;
  return a.tipo === "ninguna" && b.tipo === "ninguna";
}

export interface EleccionInicial {
  eleccion: EleccionPropina;
  /** true si la marcó el local (preselección) y el comensal todavía no la tocó. */
  sugerida: boolean;
}

/**
 * Qué propina muestra la pantalla al abrir. Una elección ya guardada en el
 * pedido gana siempre. Si no hay y el local activó la preselección, se marca
 * el 10 % solo si está entre sus porcentajes sugeridos; si no, nada. La
 * preselección no se guarda hasta que el comensal toca Pagar o Avisar al
 * mozo (ver cuerpoDePropina y hayQueGuardarPropina).
 */
export function eleccionAlAbrir(
  totales: TotalesDelPedido,
  propina: PropinaDelLocal,
): EleccionInicial {
  const guardada = eleccionGuardada(totales);
  if (guardada.tipo !== "ninguna") {
    return { eleccion: guardada, sugerida: false };
  }
  if (
    propina.preseleccionada &&
    propina.sugeridas.includes(PORCENTAJE_PRESELECCIONADO)
  ) {
    return {
      eleccion: {
        tipo: "porcentaje",
        porcentaje: PORCENTAJE_PRESELECCIONADO,
      },
      sugerida: true,
    };
  }
  return { eleccion: SIN_PROPINA, sugerida: false };
}

/** Body de PUT .../pagos/propina. Vacío = sin propina. */
export function cuerpoDePropina(
  eleccion: EleccionPropina,
): { porcentaje?: number; monto?: number } {
  if (eleccion.tipo === "porcentaje") return { porcentaje: eleccion.porcentaje };
  if (eleccion.tipo === "monto") return { monto: eleccion.monto };
  return {};
}

/**
 * Si hay que hacer el PUT antes de pagar: cuando lo que se ve es distinto de
 * lo guardado. Una preselección sin tocar sí se guarda (el pedido todavía no
 * la tiene); sin propina y nada guardado, no.
 */
export function hayQueGuardarPropina(
  eleccion: EleccionPropina,
  totales: TotalesDelPedido,
): boolean {
  return !mismaEleccion(eleccion, eleccionGuardada(totales));
}

/** «Propina (10 %)» con porcentaje; «Propina» con monto libre. */
export function etiquetaDePropina(eleccion: EleccionPropina): string {
  return eleccion.tipo === "porcentaje"
    ? `Propina (${eleccion.porcentaje} %)`
    : "Propina";
}

export type EstadoMontoPropina =
  | { tipo: "vacio" }
  | { tipo: "invalido" }
  | { tipo: "excede"; tope: number }
  | { tipo: "ok"; monto: number };

/**
 * «Otro monto»: pesos enteros desde $ 1 hasta el consumo (sin centavos). Los
 * espacios se ignoran.
 */
export function evaluarMontoPropina(
  texto: string,
  consumo: number | string,
): EstadoMontoPropina {
  const limpio = texto.replace(/\s/g, "");
  if (limpio === "") return { tipo: "vacio" };
  if (!/^\d{1,8}$/.test(limpio) || Number(limpio) < 1) {
    return { tipo: "invalido" };
  }
  const monto = Number(limpio);
  const tope = topeDePropina(consumo);
  return monto > tope ? { tipo: "excede", tope } : { tipo: "ok", monto };
}

/** Mensaje de un monto libre que no sirve, o null si está vacío o es válido. */
export function errorMontoPropina(estado: EstadoMontoPropina): string | null {
  if (estado.tipo === "invalido") return MENSAJE_MONTO_PROPINA_INVALIDO;
  if (estado.tipo === "excede") {
    return `La propina no puede superar el consumo (${formatearPrecio(estado.tope)})`;
  }
  return null;
}

/**
 * Qué decirle al comensal si falla PUT .../pagos/propina. 400 (monto mayor al
 * consumo), 409 (ya hay un pago en curso o el pedido ya no espera el pago) y
 * 410 (mesa cerrada) traen el motivo redactado por el backend.
 */
export function mensajeErrorPropina(
  status: number,
  mensajeBackend?: string,
): string {
  switch (status) {
    case 400:
    case 409:
    case 410:
      return mensajeBackend ?? MENSAJE_ERROR_PROPINA;
    case 401:
    case 403:
    case 404:
      return MENSAJE_SIN_ACCESO;
    default:
      return MENSAJE_ERROR_PROPINA;
  }
}
