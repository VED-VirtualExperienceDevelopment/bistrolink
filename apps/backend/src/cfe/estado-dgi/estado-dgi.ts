import { CfeEstadoDgi } from '@prisma/client';

/**
 * HU-009 (BL-455): códigos de DGI que informa Surtec en la consulta de
 * emitidos (v2 desde BL-471). Cualquier otro valor (o ninguno) es que DGI todavía no
 * respondió: el CFE sigue PENDIENTE y se vuelve a consultar. En el ambiente
 * de pruebas de Surtec se vio «NE» (no enviado): Surtec manda los CFE a la
 * DGI por tandas, no apenas se emiten.
 */
const POR_CODIGO: Readonly<Record<string, CfeEstadoDgi>> = {
  AE: 'ACEPTADO', // Comprobante recibido
  BE: 'RECHAZADO', // Comprobante rechazado
  CE: 'OBSERVADO', // Comprobante observado
};

export function estadoDgiDesdeCodigo(
  codigo: string | null | undefined,
): CfeEstadoDgi {
  return (codigo && POR_CODIGO[codigo.trim().toUpperCase()]) || 'PENDIENTE';
}

/** Definitivo: ya no se consulta (todo lo que no es PENDIENTE). */
export function esEstadoDefinitivo(estado: CfeEstadoDgi): boolean {
  return estado !== 'PENDIENTE';
}

/**
 * Fecha AAAA-MM-DD en hora de Uruguay (filtros del listado de comprobantes).
 * Un CFE emitido a las 22:00 del 2/11 en Montevideo es del 2/11, aunque en
 * UTC ya sea el 3/11.
 */
export function fechaUruguay(fecha: Date): string {
  // en-CA da el formato AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}
