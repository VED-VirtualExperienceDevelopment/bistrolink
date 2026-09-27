import { IsUUID } from 'class-validator';

export class ListarLayoutQueryDto {
  // Un tenant puede tener más de un Restaurante (Anexo 6 §4.2) — el mapa de
  // mesas es por restaurante, mismo criterio que ya usa CreateUsuarioDto.
  // 'loose': acepta cualquier id con formato 8-4-4-4-12 hex, igual que
  // Postgres (columna uuid) y ParseUUIDPipe en las rutas :id. El modo por
  // defecto exige RFC 4122 y rechaza los ids del seed Demo (2222…),
  // lo que dejaba el mapa de ese restaurante sin poder cargarse (TC-I-032).
  @IsUUID('loose')
  restauranteId: string;
}
