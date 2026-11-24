import { Injectable } from '@nestjs/common';
import {
  ConfiguracionEstablecimientoService,
  type ConfiguracionEstablecimiento,
} from '../configuracion/configuracion-establecimiento.service';
import type { ActualizarConfiguracionDto } from '../configuracion/dto/actualizar-configuracion.dto';
import {
  CONFIGURACION_DEL_SEED,
  LOCAL_DEL_SEED,
  RAZON_SOCIAL_DEL_SEED,
} from './datos-seed';

/** Resumen del área `configuracion` (lo que responde la API). */
export interface ResumenConfiguracion {
  /** Campos que volvieron (o volverían, en dry-run) al valor del seed. */
  camposRestablecidos: string[];
}

/** La configuración que define el seed para este tenant. */
export function configuracionDelSeed(
  tenantId: string,
): ActualizarConfiguracionDto {
  const razonSocial = RAZON_SOCIAL_DEL_SEED[tenantId];
  const local = LOCAL_DEL_SEED[tenantId];
  return {
    ...CONFIGURACION_DEL_SEED,
    propinasSugeridas: [...CONFIGURACION_DEL_SEED.propinasSugeridas],
    // Solo los tenants de testing tienen razón social, nombre y dirección
    // en el seed (HU-043, BL-561).
    ...(razonSocial ? { razonSocial } : {}),
    ...(local ? { nombre: local.nombre, direccion: local.direccion } : {}),
  };
}

/**
 * HU-043 (BL-535): el logo y la portada no vienen como key en la
 * configuración, sino como URL firmada. Para compararlos con el seed (sin
 * imagen) alcanza con saber si hay URL: null = sin imagen.
 */
const URL_DE_LA_IMAGEN: Readonly<
  Record<string, keyof ConfiguracionEstablecimiento>
> = {
  logoKey: 'logoUrl',
  portadaKey: 'portadaUrl',
};

/** Lo que tiene guardado el establecimiento en ese campo del seed. */
function valorVigente(
  actual: ConfiguracionEstablecimiento,
  campo: string,
): unknown {
  const url = URL_DE_LA_IMAGEN[campo];
  if (url) return actual[url] ? 'con imagen' : null;
  return actual[campo as keyof ConfiguracionEstablecimiento];
}

/** Los campos que difieren del seed, con el valor del seed. */
export function diferenciasConElSeed(
  actual: ConfiguracionEstablecimiento,
  seed: ActualizarConfiguracionDto,
): ActualizarConfiguracionDto {
  const diferencias: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(seed)) {
    const vigente = valorVigente(actual, campo);
    if (JSON.stringify(vigente) !== JSON.stringify(valor)) {
      diferencias[campo] = valor;
    }
  }
  return diferencias as ActualizarConfiguracionDto;
}

/**
 * BL-481 (BL-285, ADR 0011): deja la configuración del establecimiento como
 * el seed: medios de pago, propinas, proveedor de CFE, cola del KDS apagada
 * y razón social de los tenants de testing. El correo de privacidad no se
 * toca (el seed no lo define). HU-043: también la marca (plantilla, nombre
 * y dirección, sin logo y sin portada).
 *
 * Usa el mismo servicio que la pantalla Configuración, así que el cambio
 * queda en la auditoría (con antes y después) y el KDS se entera si cambió
 * la cola.
 */
@Injectable()
export class LimpiezaConfiguracionService {
  constructor(
    private readonly configuracion: ConfiguracionEstablecimientoService,
  ) {}

  async limpiar(
    tenantId: string,
    actorKeycloakId: string,
    dryRun: boolean,
  ): Promise<ResumenConfiguracion> {
    const actual = await this.configuracion.obtener(tenantId);
    const diferencias = diferenciasConElSeed(
      actual,
      configuracionDelSeed(tenantId),
    );
    const camposRestablecidos = Object.keys(diferencias);
    if (!dryRun && camposRestablecidos.length > 0) {
      await this.configuracion.actualizar(tenantId, diferencias, {
        id: actorKeycloakId,
      });
    }
    return { camposRestablecidos };
  }
}
