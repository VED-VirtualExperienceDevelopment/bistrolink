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

/**
 * BL-448: al conectarse (o reconectarse) el KDS recibe las solicitudes de
 * efectivo que siguen pendientes (`llamados:snapshot`). Reemplazan a los
 * avisos de efectivo que tenía, porque el servidor es quien sabe cuáles
 * siguen sin cobrar; los «solicita atención» en memoria se conservan, salvo
 * en una mesa que tiene una solicitud de efectivo (queda la más reciente
 * por mesa, como en agregarLlamado).
 */
export function combinarSnapshotLlamados(
  llamados: LlamadoMozo[],
  snapshot: LlamadoMozo[],
): LlamadoMozo[] {
  return snapshot.reduce(
    (acumulado, llamado) => agregarLlamado(acumulado, llamado),
    llamados.filter((l) => l.motivo !== "PAGO_EFECTIVO"),
  );
}

/**
 * BL-448: el pedido que tenía el aviso de efectivo ya se cobró (llega a
 * cocina como `pedido:nuevo`): se saca su banner.
 */
export function quitarLlamadoDePedido(
  llamados: LlamadoMozo[],
  pedidoId: string,
): LlamadoMozo[] {
  return llamados.filter((l) => l.pedidoId !== pedidoId);
}
