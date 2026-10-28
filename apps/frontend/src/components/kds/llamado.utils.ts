/**
 * HU-019/BL-68: llamados de las mesas en el KDS. HU-031b (BL-442): un
 * llamado puede ser porque la mesa quiere pagar en efectivo; trae el total
 * y con cuánto paga. Lógica pura, probada en test/unitarios/llamado.utils.spec.ts.
 */
import { formatearMonto } from "@/components/admin/cobros/cobros.utils";

export interface LlamadoMozo {
  mesaId: string;
  mesaNumero: number;
  ts: number;
  /** HU-031b: solo si la mesa quiere pagar en efectivo. */
  motivo?: "PAGO_EFECTIVO";
  pedidoId?: string;
  total?: string;
  pagaCon?: string | null;
}

/** Texto del banner. */
export function textoLlamado(llamado: LlamadoMozo): string {
  if (llamado.motivo !== "PAGO_EFECTIVO") {
    return `🔔 Mesa ${llamado.mesaNumero} solicita atención`;
  }
  const total = llamado.total ? `: ${formatearMonto(llamado.total)}` : "";
  const pagaCon = llamado.pagaCon
    ? ` (paga con ${formatearMonto(llamado.pagaCon)})`
    : "";
  return `💵 Mesa ${llamado.mesaNumero} quiere pagar en efectivo${total}${pagaCon}`;
}

/**
 * Un llamado por mesa. Si la mesa vuelve a llamar, queda el último: por
 * ejemplo, un «solicita atención» pasa a «quiere pagar en efectivo».
 */
export function agregarLlamado(
  llamados: LlamadoMozo[],
  nuevo: LlamadoMozo,
): LlamadoMozo[] {
  return [...llamados.filter((l) => l.mesaId !== nuevo.mesaId), nuevo];
}
