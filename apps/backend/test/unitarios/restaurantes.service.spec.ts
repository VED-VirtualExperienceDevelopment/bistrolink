import { Test, TestingModule } from '@nestjs/testing';
import { RestaurantesService } from '../../src/restaurantes/restaurantes.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';

const TENANT_ID = '554915d0-f7ed-4053-b841-56479df29fd9';

describe('RestaurantesService', () => {
  let service: RestaurantesService;

  // Helper: simula runInTenantContext ejecutando directamente el callback
  // con un mock de "tx" — mismo patrón que usuarios.service.spec.ts.
  const runInTenantContextMock = (tx: any) =>
    jest.fn((tenantId: string, fn: (tx: any) => any) => fn(tx));

  beforeEach(async () => {
    const tx = {
      restaurante: { findMany: jest.fn() },
    };

    const tenantPrismaMock = {
      runInTenantContext: runInTenantContextMock(tx),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantesService,
        { provide: TenantPrismaService, useValue: tenantPrismaMock },
      ],
    }).compile();

    service = module.get(RestaurantesService);

    (service as any).__tx = tx;
  });

  const tx = () => (service as any).__tx;

  describe('listar', () => {
    it('[TC-U-005] RestaurantesService.listar consulta findMany filtrado por tenantId, con el select y orderBy esperados', async () => {
      tx().restaurante.findMany.mockResolvedValue([]);

      await service.listar(TENANT_ID);

      expect(tx().restaurante.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        select: {
          id: true,
          nombre: true,
          direccion: true,
          timezone: true,
        },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('[TC-U-006] RestaurantesService.listar devuelve los restaurantes que resuelve Prisma', async () => {
      const restaurantesMock = [
        {
          id: '22222222-2222-2222-2222-222222222222',
          nombre: 'BistroLink Demo',
          direccion: 'Av. Italia 1234, Montevideo',
          timezone: 'America/Montevideo',
        },
      ];
      tx().restaurante.findMany.mockResolvedValue(restaurantesMock);

      const resultado = await service.listar(TENANT_ID);

      expect(resultado).toEqual(restaurantesMock);
    });

    it('[TC-U-007] RestaurantesService.listar devuelve un array vací­o si el tenant no tiene restaurantes', async () => {
      tx().restaurante.findMany.mockResolvedValue([]);

      const resultado = await service.listar(TENANT_ID);

      expect(resultado).toEqual([]);
    });
  });
});
