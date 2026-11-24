import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DESTINOS_IMAGEN, type DestinoImagen } from '../upload.constants';

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

  /**
   * HU-043 (BL-532): `item` (por defecto) o `marca` (el logo del local). Lo
   * usa solo el Administrador: la confirmación ya es solo ADMIN.
   */
  @IsOptional()
  @IsIn(DESTINOS_IMAGEN, {
    message: `Destino de la imagen no válido. Puede ser: ${DESTINOS_IMAGEN.join(', ')}`,
  })
  destino?: DestinoImagen;
}
