import { IsIn, IsOptional, Matches, ValidateIf } from 'class-validator';

/** HU-012 (BL-108): períodos del dashboard de reportes. */
export const PERIODOS_REPORTE = [
  'HOY',
  'AYER',
  'ULTIMOS_7_DIAS',
  'MES_ACTUAL',
  'PERSONALIZADO',
] as const;
export type PeriodoReporte = (typeof PERIODOS_REPORTE)[number];

/**
 * HU-012 (BL-108): canales de venta del dashboard. Se derivan del canal del
 * pedido (CANALES_DEL_FILTRO): no son un enum de la base.
 */
export const CANALES_REPORTE = ['TODOS', 'LOCAL', 'WEB', 'WHATSAPP'] as const;
export type CanalReporte = (typeof CANALES_REPORTE)[number];

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MENSAJE_FECHA = 'debe ser una fecha AAAA-MM-DD';

/**
 * HU-012 (BL-108): filtros de GET /admin/reportes. Sin filtros: hoy, todos
 * los canales. Las fechas son días del calendario en la zona horaria del
 * local; `desde` y `hasta` solo se usan (y son obligatorias) con el período
 * PERSONALIZADO.
 */
export class FiltrosReportesDto {
  @IsOptional()
  @IsIn(PERIODOS_REPORTE, {
    message: `periodo debe ser uno de: ${PERIODOS_REPORTE.join(', ')}`,
  })
  periodo: PeriodoReporte = 'HOY';

  @IsOptional()
  @IsIn(CANALES_REPORTE, {
    message: `canal debe ser uno de: ${CANALES_REPORTE.join(', ')}`,
  })
  canal: CanalReporte = 'TODOS';

  @ValidateIf(
    (filtros: FiltrosReportesDto) => filtros.periodo === 'PERSONALIZADO',
  )
  @Matches(FECHA, { message: `desde ${MENSAJE_FECHA}` })
  desde?: string;

  @ValidateIf(
    (filtros: FiltrosReportesDto) => filtros.periodo === 'PERSONALIZADO',
  )
  @Matches(FECHA, { message: `hasta ${MENSAJE_FECHA}` })
  hasta?: string;
}
