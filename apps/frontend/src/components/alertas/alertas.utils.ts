/**
 * BL-441: lógica pura de la campana y del panel de alertas del mozo.
 * Probada en test/unitarios/alertas.utils.spec.ts.
 */
import { formatearMonto } from "@/components/admin/cobros/cobros.utils";
import {
  agregarLlamado,
  type LlamadoMozo,
} from "@/components/kds/llamado.utils";

/** Desde cuánto esperando una alerta se marca como demorada (2 minutos). */
export const UMBRAL_DEMORA_MS = 2 * 60_000;

/** Más antigua primero: la que lleva más tiempo esperando. No muta la entrada. */
export function ordenarLlamados(llamados: LlamadoMozo[]): LlamadoMozo[] {
  return [...llamados].sort((a, b) => a.ts - b.ts);
}

/**
 * Como agregarLlamado (una alerta por mesa, queda la última), pero la mesa
 * conserva la hora de su primer llamado: si insiste, no pierde su lugar en
 * la lista ni el tiempo que lleva esperando.
 */
export function agregarLlamadoConservandoEspera(
  llamados: LlamadoMozo[],
  nuevo: LlamadoMozo,
): LlamadoMozo[] {
  const anterior = llamados.find((l) => l.mesaId === nuevo.mesaId);
  return agregarLlamado(
    llamados,
    anterior ? { ...nuevo, ts: Math.min(anterior.ts, nuevo.ts) } : nuevo,
  );
}

/** `ts` y `ahora` en milisegundos (el backend manda Date.now()). */
export function tiempoTranscurrido(ts: number, ahora: number): string {
  const segundos = Math.max(0, Math.floor((ahora - ts) / 1000));
  if (segundos < 60) return `hace ${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  return `hace ${Math.floor(minutos / 60)} h`;
}

/** La alerta lleva esperando el umbral o más. */
export function esDemorada(
  ts: number,
  ahora: number,
  umbralMs: number = UMBRAL_DEMORA_MS,
): boolean {
  return ahora - ts >= umbralMs;
}

/** Texto del contador: vacío sin alertas y «9+» si pasan de 9. */
export function textoContador(cantidad: number): string {
  if (cantidad <= 0) return "";
  return cantidad > 9 ? "9+" : String(cantidad);
}

/** Nombre accesible de la campana, con la cantidad. */
export function etiquetaCampana(cantidad: number): string {
  if (cantidad <= 0) return "Alertas, sin pendientes";
  return `Alertas, ${cantidad} ${cantidad === 1 ? "pendiente" : "pendientes"}`;
}

/** Título de cada alerta en el panel (sin emoji: el ícono va aparte). */
export function tituloAlerta(llamado: LlamadoMozo): string {
  return llamado.motivo === "PAGO_EFECTIVO"
    ? `Mesa ${llamado.mesaNumero} quiere pagar en efectivo`
    : `Mesa ${llamado.mesaNumero} solicita atención`;
}

/** Línea de detalle de un aviso de efectivo; null si no corresponde. */
export function detalleEfectivo(llamado: LlamadoMozo): string | null {
  if (llamado.motivo !== "PAGO_EFECTIVO" || !llamado.total) return null;
  const pagaCon = llamado.pagaCon
    ? ` · paga con ${formatearMonto(llamado.pagaCon)}`
    : "";
  return `Total ${formatearMonto(llamado.total)}${pagaCon}`;
}
