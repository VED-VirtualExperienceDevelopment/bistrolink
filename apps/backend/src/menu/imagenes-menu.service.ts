import { BadRequestException, Injectable } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ProcesadorImagenService } from './procesador-imagen.service';
import {
  LADO_MAXIMO_IMAGEN_PX,
  LADO_MAXIMO_LOGO_PX,
  type DestinoImagen,
} from './upload.constants';

export interface ImagenConfirmada {
  /**
   * Key de la imagen publicada: {tenant}/menu/{uuid}.webp, o
   * {tenant}/menu/marca/{uuid}.webp si es el logo (HU-043).
   */
  key: string;
  /** URL firmada de lectura, para mostrarla en el formulario. */
  url: string | null;
}

/**
 * BL-386: confirmación de una imagen subida a la cuarentena.
 *
 * 1. Valida que la key sea de la cuarentena del tenant del token.
 * 2. Lee el archivo (tamaño real ≤ 5 MB).
 * 3. Lo verifica y lo regenera (ProcesadorImagenService).
 * 4. Publica la imagen nueva en {tenant}/menu/{uuid}.webp.
 *
 * HU-043 (BL-532): con destino `marca` (el logo del local), la imagen sale
 * de hasta 512 px y se publica en {tenant}/menu/marca/{uuid}.webp. Los
 * controles son los mismos que para las fotos de la carta.
 *
 * El uuid se conserva: confirmar dos veces la misma subida da la misma key
 * (la operación es idempotente). El original queda en la cuarentena y el
 * bucket lo borra solo.
 */
@Injectable()
export class ImagenesMenuService {
  constructor(
    private readonly storage: StorageService,
    private readonly procesador: ProcesadorImagenService,
  ) {}

  async confirmar(
    keyCuarentena: string,
    tenantId: string,
    destino: DestinoImagen = 'item',
  ): Promise<ImagenConfirmada> {
    const uuid = this.storage.uuidDeKeyDeCuarentena(keyCuarentena, tenantId);
    if (!uuid) {
      // Mismo mensaje para "formato inválido" y "de otro tenant": no se
      // revela si la key existe en otro establecimiento.
      throw new BadRequestException(
        'La imagen no es válida para este establecimiento',
      );
    }

    const original = await this.storage.leerDeCuarentena(keyCuarentena);
    const esLogo = destino === 'marca';
    const procesada = await this.procesador.procesar(original, {
      ladoMaximo: esLogo ? LADO_MAXIMO_LOGO_PX : LADO_MAXIMO_IMAGEN_PX,
    });

    const keyFinal = esLogo
      ? `${tenantId}/menu/marca/${uuid}.webp`
      : `${tenantId}/menu/${uuid}.webp`;
    await this.storage.guardarImagenPublicada(keyFinal, procesada);

    return {
      key: keyFinal,
      url: await this.storage.urlFirmadaDeLectura(keyFinal),
    };
  }
}
