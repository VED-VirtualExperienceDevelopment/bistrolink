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
 * BL-448 / BL-441: al conectarse (o reconectarse) el KDS recibe todas las
 * alertas que siguen pendientes (`llamados:snapshot`: llamados de mesa y
 * avisos de efectivo). El servidor es quien sabe cuáles siguen sin atender,
 * así que el snapshot reemplaza por completo lo que había en pantalla: una
 * alerta que se atendió o se cerró mientras no había conexión no tiene que
 * quedar a la vista. Una alerta por mesa (queda la última, como en
 * agregarLlamado).
 */
export function llamadosDelSnapshot(snapshot: LlamadoMozo[]): LlamadoMozo[] {
  return snapshot.reduce(
    (acumulado, llamado) => agregarLlamado(acumulado, llamado),
    [] as LlamadoMozo[],
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
