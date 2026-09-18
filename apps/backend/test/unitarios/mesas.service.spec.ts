import { NotFoundException } from '@nestjs/common';
import { MesasService } from '../../src/mesas/mesas.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MESA_ID = '33333333-3333-3333-3333-333333333333';

describe('MesasService.llamarMozo', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let service: MesasService;

  beforeEach(() => {
    mockTenantPrisma = { runInTenantContext: jest.fn() };
    mockKdsGateway = { emitirLlamado: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('rechaza con 404 si la mesa no existe en este tenant', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue(null);

    await expect(service.llamarMozo(TENANT_ID, MESA_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockKdsGateway.emitirLlamado).not.toHaveBeenCalled();
  });

  it('con la mesa encontrada: emite el llamado con id y numero de mesa', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: MESA_ID,
      numero: 5,
    });

    const resultado = await service.llamarMozo(TENANT_ID, MESA_ID);

    expect(mockKdsGateway.emitirLlamado).toHaveBeenCalledWith(
      TENANT_ID,
      MESA_ID,
      5,
    );
    expect(resultado).toEqual({ ok: true });
  });
});
