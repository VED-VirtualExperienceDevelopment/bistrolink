import { IsIn, IsInt, Min } from 'class-validator';
import {
  TIPOS_IMAGEN_PERMITIDOS,
  TipoImagenPermitido,
} from '../upload.constants';

export class PresignedUrlDto {
  @IsIn(TIPOS_IMAGEN_PERMITIDOS, {
    message: 'Formato no permitido. Solo se aceptan imágenes JPEG, PNG o WEBP.',
  })
  contentType: TipoImagenPermitido;

  @IsInt()
  @Min(1, { message: 'La imagen está vacía' })
  fileSize: number;
}
