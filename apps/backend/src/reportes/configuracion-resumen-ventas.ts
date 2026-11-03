/**
 * HU-012 (BL-219): parámetros del job que mantiene el resumen de ventas,
 * desde variables de entorno.
 *
 * - REPORTES_RESUMEN_HABILITADO: «false» apaga el job. En los tests
 *   (NODE_ENV=test) está apagado salvo que se habilite a propósito: los tests
 *   de integración llaman al servicio directamente.
 * - REPORTES_RESUMEN_INTERVALO_MIN (15): cada cuánto corre el job.
 * - REPORTES_RESUMEN_VENTANA_HORAS (48): cuántas horas hacia atrás recalcula
 *   en cada corrida. Recoge los pagos que se aprobaron tarde y los
 *   reembolsos de esas horas.
 *
 * El dashboard no depende del job para estar al día: cada pago aprobado
 * recalcula su hora en el momento (PedidosService.notificarPedidoConfirmado).
 */
export interface ConfiguracionResumenVentas {
  habilitado: boolean;
  intervaloMs: number;
  ventanaHoras: number;
}

const MINUTO_MS = 60 * 1000;

function enteroPositivo(valor: string | undefined, porDefecto: number): number {
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : porDefecto;
}

export function configuracionResumenVentas(
  env: NodeJS.ProcessEnv,
): ConfiguracionResumenVentas {
  const valor = env.REPORTES_RESUMEN_HABILITADO?.trim().toLowerCase();
  const habilitado =
    env.NODE_ENV === 'test' ? valor === 'true' : valor !== 'false';

  return {
    habilitado,
    intervaloMs:
      enteroPositivo(env.REPORTES_RESUMEN_INTERVALO_MIN, 15) * MINUTO_MS,
    ventanaHoras: enteroPositivo(env.REPORTES_RESUMEN_VENTANA_HORAS, 48),
  };
}
