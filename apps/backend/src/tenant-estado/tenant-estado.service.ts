import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * BL-413: código que acompaña al 403 de un establecimiento suspendido. El
 * frontend lo usa para mostrar «no disponible» en vez de un error genérico
 * (hay otros 403 que no tienen nada que ver con la suspensión).
 */
export const CODIGO_ESTABLECIMIENTO_SUSPENDIDO = 'ESTABLECIMIENTO_SUSPENDIDO';

/** Lo que ve el personal del restaurante (Admin, Mozo, Cocina). */
export const MENSAJE_SUSPENDIDO_PERSONAL =
  'El establecimiento está suspendido. Comunicate con BistroLink para reactivarlo.';

/** Lo que ve el comensal: sin el motivo ni la palabra «suspendido». */
export const MENSAJE_SUSPENDIDO_COMENSAL =
  'Este restaurante no está disponible por el momento.';

/**
 * BL-413: cuánto se recuerda el estado de un tenant. Suspender y reactivar
 * borran la entrada en el acto (invalidar), así que el plazo solo importa
 * si hubiera más de una instancia de la API.
 */
export const TTL_CACHE_ESTADO_MS = 60_000;

/** El 403 con el código, en el formato estándar de Nest. */
export function errorEstablecimientoSuspendido(
  mensaje: string = MENSAJE_SUSPENDIDO_PERSONAL,
): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    message: mensaje,
    codigo: CODIGO_ESTABLECIMIENTO_SUSPENDIDO,
  });
}

/** El mensaje según quién es: el comensal no ve el de la plataforma. */
export function mensajeSuspendidoPara(roles: string[]): string {
  return roles.includes('COMENSAL')
    ? MENSAJE_SUSPENDIDO_COMENSAL
    : MENSAJE_SUSPENDIDO_PERSONAL;
}

/**
 * BL-413: ¿el establecimiento está suspendido? Lo consultan en cada request
 * la estrategia JWT de tenant, la autenticación de los WebSocket, la emisión
 * del token del comensal y el menú público.
 *
 * - Singleton, con su propio PrismaClient y el rol de runtime: la estrategia
 *   de Passport no puede depender de TenantPrismaService, que es por
 *   request. La tabla `tenant` no tiene RLS, así que no hace falta el
 *   contexto de un tenant.
 * - Caché en memoria de TTL_CACHE_ESTADO_MS por tenant, para no ir a la base
 *   en cada request. Un tenant que no existe cuenta como no suspendido: el
 *   que decide si existe es cada endpoint (404).
 * - Un solo módulo (TenantEstadoModule) lo provee para toda la aplicación:
 *   así suspender y reactivar invalidan la misma caché que leen los guards.
 */
@Injectable()
export class TenantEstadoService implements OnModuleDestroy {
  private readonly prisma = new PrismaClient({
    datasourceUrl: process.env.RUNTIME_DATABASE_URL,
  });
  private readonly cache = new Map<
    string,
    { suspendido: boolean; venceEn: number }
  >();

  /** Reloj, reemplazable en los tests. */
  protected ahora(): number {
    return Date.now();
  }

  async estaSuspendido(tenantId: string): Promise<boolean> {
    const ahora = this.ahora();
    const guardado = this.cache.get(tenantId);
    if (guardado && guardado.venceEn > ahora) {
      return guardado.suspendido;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { estado: true },
    });
    const suspendido = tenant?.estado === 'SUSPENDIDO';
    this.cache.set(tenantId, {
      suspendido,
      venceEn: ahora + TTL_CACHE_ESTADO_MS,
    });
    return suspendido;
  }

  /** 403 con CODIGO_ESTABLECIMIENTO_SUSPENDIDO si está suspendido. */
  async asegurarActivo(
    tenantId: string,
    mensaje: string = MENSAJE_SUSPENDIDO_PERSONAL,
  ): Promise<void> {
    if (await this.estaSuspendido(tenantId)) {
      throw errorEstablecimientoSuspendido(mensaje);
    }
  }

  /** Después de suspender o reactivar: la próxima consulta va a la base. */
  invalidar(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
