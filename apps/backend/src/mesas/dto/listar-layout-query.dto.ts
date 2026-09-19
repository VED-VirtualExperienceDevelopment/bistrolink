import { IsUUID } from 'class-validator';

export class ListarLayoutQueryDto {
  // Un tenant puede tener más de un Restaurante (Anexo 6 §4.2) — el mapa de
  // mesas es por restaurante, mismo criterio que ya usa CreateUsuarioDto.
  @IsUUID()
  restauranteId: string;
}
