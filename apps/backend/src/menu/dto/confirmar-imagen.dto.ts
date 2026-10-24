import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * BL-386: key de cuarentena que devolvió POST /admin/menu/presigned-url.
 * Acá solo se valida que sea un texto razonable; el formato exacto
 * (incoming/{tenant}/{uuid}) y el tenant los valida el servicio.
 */
export class ConfirmarImagenDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta la imagen a confirmar' })
  @MaxLength(200)
  key: string;
}
