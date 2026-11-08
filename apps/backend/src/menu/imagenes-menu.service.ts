import { BadRequestException, Injectable } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ProcesadorImagenService } from './procesador-imagen.service';

export interface ImagenConfirmada {
  /** Key de la imagen publicada: {tenant}/menu/{uuid}.webp */
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
    const procesada = await this.procesador.procesar(original);

    const keyFinal = `${tenantId}/menu/${uuid}.webp`;
    await this.storage.guardarImagenPublicada(keyFinal, procesada);

    return {
      key: keyFinal,
      url: await this.storage.urlFirmadaDeLectura(keyFinal),
    };
  }
}
