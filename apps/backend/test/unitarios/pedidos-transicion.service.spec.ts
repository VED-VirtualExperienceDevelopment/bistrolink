import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PedidoEstado } from '@prisma/client';
import { PedidosTransicionService } from '../../src/pedidos/pedidos-transicion.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = 'pedido-1';
const KEYCLOAK_ID = 'kc-mozo-1';
const USUARIO_ID = 'usuario-mozo-1';

describe('PedidosTransicionService', () => {
  let service: PedidosTransicionService;

  // Mismo patron que usuarios.service.spec.ts: runInTenantContext ejecuta
  // directamente el callback con un mock de "tx" (el cliente de Prisma
  // dentro de la transaccion), sin pasar por Postgres real.
  const runInTenantContextMock = (tx: any) =>
    jest.fn((tenantId: string, fn: (tx: any) => any) => fn(tx));

  beforeEach(async () => {
    const tx = {
      pedido: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      usuario: { findUnique: jest.fn() },
      pedidoEstadoHistorial: { create: jest.fn() },
    };

    const tenantPrismaMock = {
      runInTenantContext: runInTenantContextMock(tx),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PedidosTransicionService,
        { provide: TenantPrismaService, useValue: tenantPrismaMock },
      ],
    }).compile();

    service = module.get(PedidosTransicionService);
    (service as any).__tx = tx;
  });

  const tx = () => (service as any).__tx;

  describe('transicionar', () => {
    it('[TC-U-KDS-010] transicionar aplica RECIBIDO -> EN_PREPARACION y crea el historial en la misma operacion', async () => {
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.RECIBIDO,
      });
      tx().usuario.findUnique.mockResolvedValue({ id: USUARIO_ID });
      tx().pedido.update.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.EN_PREPARACION,
        updatedAt: new Date('2026-08-30T12:00:00Z'),
      });

      const resultado = await service.transicionar({
        tenantId: TENANT_ID,
        keycloakId: KEYCLOAK_ID,
        pedidoId: PEDIDO_ID,
        nuevoEstado: PedidoEstado.EN_PREPARACION,
      });

      expect(tx().usuario.findUnique).toHaveBeenCalledWith({
        where: { keycloakId: KEYCLOAK_ID },
      });
      expect(tx().pedido.update).toHaveBeenCalledWith({
        where: { id: PEDIDO_ID },
        data: { estado: PedidoEstado.EN_PREPARACION },
      });
      expect(tx().pedidoEstadoHistorial.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          pedidoId: PEDIDO_ID,
          usuarioId: USUARIO_ID,
          estadoAnterior: PedidoEstado.RECIBIDO,
          estadoNuevo: PedidoEstado.EN_PREPARACION,
        },
      });
      expect(resultado).toEqual({
        id: PEDIDO_ID,
        estado: PedidoEstado.EN_PREPARACION,
        actualizadoEn: '2026-08-30T12:00:00.000Z',
      });
    });

    it('[TC-U-KDS-011] transicionar aplica EN_PREPARACION -> LISTO_PARA_ENTREGAR', async () => {
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.EN_PREPARACION,
      });
      tx().usuario.findUnique.mockResolvedValue({ id: USUARIO_ID });
      tx().pedido.update.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.LISTO_PARA_ENTREGAR,
        updatedAt: new Date('2026-08-30T12:05:00Z'),
      });

      const resultado = await service.transicionar({
        tenantId: TENANT_ID,
        keycloakId: KEYCLOAK_ID,
        pedidoId: PEDIDO_ID,
        nuevoEstado: PedidoEstado.LISTO_PARA_ENTREGAR,
      });

      expect(resultado.estado).toBe(PedidoEstado.LISTO_PARA_ENTREGAR);
    });

    it('[TC-U-KDS-012] transicionar rechaza saltear un estado (RECIBIDO -> LISTO_PARA_ENTREGAR, sin pasar por EN_PREPARACION)', async () => {
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.RECIBIDO,
      });

      await expect(
        service.transicionar({
          tenantId: TENANT_ID,
          keycloakId: KEYCLOAK_ID,
          pedidoId: PEDIDO_ID,
          nuevoEstado: PedidoEstado.LISTO_PARA_ENTREGAR,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(tx().pedido.update).not.toHaveBeenCalled();
      expect(tx().pedidoEstadoHistorial.create).not.toHaveBeenCalled();
    });

    it('[TC-U-KDS-013] transicionar rechaza operar sobre un pedido en estado terminal (LISTO_PARA_ENTREGAR no tiene transiciones desde el KDS)', async () => {
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.LISTO_PARA_ENTREGAR,
      });

      await expect(
        service.transicionar({
          tenantId: TENANT_ID,
          keycloakId: KEYCLOAK_ID,
          pedidoId: PEDIDO_ID,
          nuevoEstado: PedidoEstado.EN_PREPARACION,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('[TC-U-KDS-014] transicionar devuelve 404 si el pedido no existe (o pertenece a otro tenant, oculto por RLS)', async () => {
      tx().pedido.findUnique.mockResolvedValue(null);

      await expect(
        service.transicionar({
          tenantId: TENANT_ID,
          keycloakId: KEYCLOAK_ID,
          pedidoId: 'pedido-inexistente',
          nuevoEstado: PedidoEstado.EN_PREPARACION,
        }),
      ).rejects.toThrow(NotFoundException);

      // No distinguir "no existe" de "es de otro tenant" hacia afuera:
      // ninguno de los dos casos debe seguir de largo hacia el usuario.
      expect(tx().usuario.findUnique).not.toHaveBeenCalled();
    });

    it('[TC-U-KDS-015] transicionar devuelve 404 si el usuario MOZO/ADMIN no tiene fila en Usuario (desincronizacion con Keycloak)', async () => {
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.RECIBIDO,
      });
      tx().usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.transicionar({
          tenantId: TENANT_ID,
          keycloakId: KEYCLOAK_ID,
          pedidoId: PEDIDO_ID,
          nuevoEstado: PedidoEstado.EN_PREPARACION,
        }),
      ).rejects.toThrow(NotFoundException);

      // El pedido NO debe quedar actualizado si no se puede atribuir la
      // transicion a un usuario real - evita un historial huerfano.
      expect(tx().pedido.update).not.toHaveBeenCalled();
      expect(tx().pedidoEstadoHistorial.create).not.toHaveBeenCalled();
    });
  });

  describe('listarPendientes', () => {
    it('[TC-U-KDS-016] listarPendientes consulta solo RECIBIDO/EN_PREPARACION y devuelve el shape esperado por el frontend', async () => {
      tx().pedido.findMany.mockResolvedValue([
        {
          id: PEDIDO_ID,
          estado: PedidoEstado.RECIBIDO,
          createdAt: new Date('2026-08-30T12:00:00Z'),
          mesa: { numero: 4 },
          lineas: [
            {
              id: 'linea-1',
              nombreSnapshot: 'Milanesa a la napolitana',
              cantidad: 2,
            },
          ],
        },
      ]);

      const resultado = await service.listarPendientes(TENANT_ID);

      expect(tx().pedido.findMany).toHaveBeenCalledWith({
        where: {
          estado: { in: [PedidoEstado.RECIBIDO, PedidoEstado.EN_PREPARACION] },
        },
        include: { mesa: true, lineas: true },
        orderBy: { createdAt: 'asc' },
      });

      expect(resultado).toEqual([
        {
          id: PEDIDO_ID,
          mesaNumero: 4,
          estado: PedidoEstado.RECIBIDO,
          createdAt: '2026-08-30T12:00:00.000Z',
          lineas: [
            {
              id: 'linea-1',
              nombreSnapshot: 'Milanesa a la napolitana',
              cantidad: 2,
            },
          ],
        },
      ]);
    });

    it('[TC-U-KDS-017] listarPendientes devuelve un array vacio cuando no hay pedidos activos', async () => {
      tx().pedido.findMany.mockResolvedValue([]);

      const resultado = await service.listarPendientes(TENANT_ID);

      expect(resultado).toEqual([]);
    });
  });
});
