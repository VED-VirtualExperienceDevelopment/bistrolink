import { ForbiddenException } from '@nestjs/common';
import {
  CODIGO_ESTABLECIMIENTO_SUSPENDIDO,
  MENSAJE_SUSPENDIDO_COMENSAL,
  MENSAJE_SUSPENDIDO_PERSONAL,
  mensajeSuspendidoPara,
  TenantEstadoService,
  TTL_CACHE_ESTADO_MS,
} from '../../src/tenant-estado/tenant-estado.service';

/**
 * BL-413: estado del establecimiento con caché. La base se reemplaza por un
 * findUnique simulado y el reloj por uno que se adelanta a mano.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

class TenantEstadoDePrueba extends TenantEstadoService {
  reloj = 1_000_000;
  protected ahora(): number {
    return this.reloj;
  }
}

describe('TenantEstadoService (BL-413)', () => {
  let service: TenantEstadoDePrueba;
  let findUnique: jest.Mock;

  beforeEach(() => {
    service = new TenantEstadoDePrueba();
    findUnique = jest.fn().mockResolvedValue({ estado: 'ACTIVO' });
    (service as unknown as { prisma: unknown }).prisma = {
      tenant: { findUnique },
    };
  });

  it('[TC-U-128] lee el estado de la tabla tenant y lo guarda en caché', async () => {
    await expect(service.estaSuspendido(TENANT_ID)).resolves.toBe(false);
    await expect(service.estaSuspendido(TENANT_ID)).resolves.toBe(false);

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      select: { estado: true },
    });
  });

  it(`[TC-U-129] vuelve a la base cuando pasan ${TTL_CACHE_ESTADO_MS / 1000} s`, async () => {
    await service.estaSuspendido(TENANT_ID);
    findUnique.mockResolvedValue({ estado: 'SUSPENDIDO' });

    service.reloj += TTL_CACHE_ESTADO_MS - 1;
    await expect(service.estaSuspendido(TENANT_ID)).resolves.toBe(false);

    service.reloj += 1;
    await expect(service.estaSuspendido(TENANT_ID)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('[TC-U-130] invalidar hace que la próxima consulta vea el cambio en el acto', async () => {
    await service.estaSuspendido(TENANT_ID);
    findUnique.mockResolvedValue({ estado: 'SUSPENDIDO' });

    service.invalidar(TENANT_ID);

    await expect(service.estaSuspendido(TENANT_ID)).resolves.toBe(true);
  });

  it('un tenant que no existe cuenta como no suspendido (el 404 lo decide cada endpoint)', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.estaSuspendido(TENANT_ID)).resolves.toBe(false);
  });

  it('[TC-U-131] asegurarActivo responde 403 con el código y el mensaje pedido', async () => {
    findUnique.mockResolvedValue({ estado: 'SUSPENDIDO' });

    const error = await service
      .asegurarActivo(TENANT_ID, MENSAJE_SUSPENDIDO_COMENSAL)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: MENSAJE_SUSPENDIDO_COMENSAL,
      codigo: CODIGO_ESTABLECIMIENTO_SUSPENDIDO,
    });
  });

  it('asegurarActivo no hace nada con un establecimiento activo', async () => {
    await expect(service.asegurarActivo(TENANT_ID)).resolves.toBeUndefined();
  });

  it('el comensal recibe el mensaje «no disponible»; el personal, el de la plataforma', () => {
    expect(mensajeSuspendidoPara(['COMENSAL'])).toBe(
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
    expect(mensajeSuspendidoPara(['ADMIN'])).toBe(MENSAJE_SUSPENDIDO_PERSONAL);
    expect(mensajeSuspendidoPara([])).toBe(MENSAJE_SUSPENDIDO_PERSONAL);
  });

  it('sin reemplazar el reloj usa la hora actual: guarda en caché y vence', async () => {
    jest.useFakeTimers();
    try {
      const real = new TenantEstadoService();
      const buscar = jest.fn().mockResolvedValue({ estado: 'ACTIVO' });
      (real as unknown as { prisma: unknown }).prisma = {
        tenant: { findUnique: buscar },
      };

      await real.estaSuspendido(TENANT_ID);
      await real.estaSuspendido(TENANT_ID);
      expect(buscar).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(TTL_CACHE_ESTADO_MS);
      await real.estaSuspendido(TENANT_ID);
      expect(buscar).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('al cerrar la aplicación desconecta su cliente de Prisma', async () => {
    const $disconnect = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { prisma: unknown }).prisma = { $disconnect };

    await service.onModuleDestroy();

    expect($disconnect).toHaveBeenCalledTimes(1);
  });
});
