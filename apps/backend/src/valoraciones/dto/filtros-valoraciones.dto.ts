import { IsIn, IsOptional, Matches, ValidateIf } from 'class-validator';
import {
  PERIODOS_REPORTE,
  type PeriodoReporte,
} from '../../reportes/dto/filtros-reportes.dto';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MENSAJE_FECHA = 'debe ser una fecha AAAA-MM-DD';

/**
 * HU-050 (BL-558): filtros de GET /admin/valoraciones. Los mismos períodos
 * que los reportes (días del calendario del local). Sin filtros: últimos 7
 * días, porque las valoraciones de un solo día suelen ser pocas.
 */
export class FiltrosValoracionesDto {
  @IsOptional()
  @IsIn(PERIODOS_REPORTE, {
    message: `periodo debe ser uno de: ${PERIODOS_REPORTE.join(', ')}`,
  })
  periodo: PeriodoReporte = 'ULTIMOS_7_DIAS';

  @ValidateIf(
    (filtros: FiltrosValoracionesDto) => filtros.periodo === 'PERSONALIZADO',
  )
  @Matches(FECHA, { message: `desde ${MENSAJE_FECHA}` })
  desde?: string;

  @ValidateIf(
    (filtros: FiltrosValoracionesDto) => filtros.periodo === 'PERSONALIZADO',
  )
  @Matches(FECHA, { message: `hasta ${MENSAJE_FECHA}` })
  hasta?: string;
}
