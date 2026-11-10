import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PedidoEstado, Prisma } from '@prisma/client';
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
        // HU-042 (BL-463): cola del KDS.
        count: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      usuario: { findUnique: jest.fn() },
      pedidoEstadoHistorial: { create: jest.fn(), createMany: jest.fn() },
      // HU-042 (BL-463): sin límite configurado (cola desactivada) por
      // defecto, así los tests anteriores no cambian.
      restaurante: { findUnique: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn(),
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
        mesa: { numero: 4 },
        lineas: [
          {
            id: 'linea-1',
            nombreSnapshot: 'Milanesa a la napolitana',
            cantidad: 2,
          },
        ],
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
        select: {
          id: true,
          estado: true,
          updatedAt: true,
          mesa: { select: { numero: true } },
          lineas: {
            select: { id: true, nombreSnapshot: true, cantidad: true },
          },
        },
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
        actualizado: {
          id: PEDIDO_ID,
          estado: PedidoEstado.EN_PREPARACION,
          actualizadoEn: '2026-08-30T12:00:00.000Z',
          mesaNumero: 4,
          lineas: [
            {
              id: 'linea-1',
              nombreSnapshot: 'Milanesa a la napolitana',
              cantidad: 2,
            },
          ],
        },
        // Con la cola desactivada no se promueve nada.
        promovidos: [],
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
        mesa: { numero: 4 },
        lineas: [],
      });

      const resultado = await service.transicionar({
        tenantId: TENANT_ID,
        keycloakId: KEYCLOAK_ID,
        pedidoId: PEDIDO_ID,
        nuevoEstado: PedidoEstado.LISTO_PARA_ENTREGAR,
      });

      expect(resultado.actualizado.estado).toBe(
        PedidoEstado.LISTO_PARA_ENTREGAR,
      );
      expect(resultado.promovidos).toEqual([]);
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

  describe('HU-042 (BL-463): cola del KDS y límite de preparación', () => {
    const conLimite = (limite: number) =>
      tx().restaurante.findUnique.mockResolvedValue({
        limitePedidosEnPreparacion: limite,
      });

    it('[TC-U-375] con la cocina al límite, rechaza pasar un pedido a preparación a mano y no lo toca', async () => {
      conLimite(5);
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.RECIBIDO,
      });
      tx().usuario.findUnique.mockResolvedValue({ id: USUARIO_ID });
      tx().pedido.count.mockResolvedValue(5);

      await expect(
        service.transicionar({
          tenantId: TENANT_ID,
          keycloakId: KEYCLOAK_ID,
          pedidoId: PEDIDO_ID,
          nuevoEstado: PedidoEstado.EN_PREPARACION,
        }),
      ).rejects.toThrow('La cocina está al límite de 5 pedidos');

      expect(tx().$executeRaw).toHaveBeenCalled();
      expect(tx().pedido.update).not.toHaveBeenCalled();
      expect(tx().pedidoEstadoHistorial.create).not.toHaveBeenCalled();
    });

    it('[TC-U-376] con lugar en cocina, pasar un pedido a preparación a mano funciona igual que antes', async () => {
      conLimite(5);
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.RECIBIDO,
      });
      tx().usuario.findUnique.mockResolvedValue({ id: USUARIO_ID });
      tx().pedido.count.mockResolvedValue(3);
      tx().pedido.update.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.EN_PREPARACION,
        updatedAt: new Date('2026-11-05T12:00:00Z'),
        mesa: { numero: 4 },
        lineas: [],
      });

      const resultado = await service.transicionar({
        tenantId: TENANT_ID,
        keycloakId: KEYCLOAK_ID,
        pedidoId: PEDIDO_ID,
        nuevoEstado: PedidoEstado.EN_PREPARACION,
      });

      expect(resultado.actualizado.estado).toBe(PedidoEstado.EN_PREPARACION);
      expect(resultado.promovidos).toEqual([]);
    });

    it('[TC-U-377] al marcar un pedido como listo, pasa a preparación el más antiguo de la cola y lo devuelve', async () => {
      conLimite(5);
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.EN_PREPARACION,
      });
      tx().usuario.findUnique.mockResolvedValue({ id: USUARIO_ID });
      tx().pedido.update.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.LISTO_PARA_ENTREGAR,
        updatedAt: new Date('2026-11-05T12:05:00Z'),
        mesa: { numero: 4 },
        lineas: [],
      });
      // Ya salió uno: quedan 4 en preparación, 1 lugar libre.
      tx().pedido.count.mockResolvedValue(4);
      tx().pedido.findMany.mockResolvedValue([
        {
          id: 'PED-101',
          mesa: { numero: 7 },
          lineas: [{ id: 'l-1', nombreSnapshot: 'Chivito', cantidad: 1 }],
        },
      ]);
      tx().pedido.updateMany.mockResolvedValue({ count: 1 });

      const resultado = await service.transicionar({
        tenantId: TENANT_ID,
        keycloakId: KEYCLOAK_ID,
        pedidoId: PEDIDO_ID,
        nuevoEstado: PedidoEstado.LISTO_PARA_ENTREGAR,
      });

      expect(resultado.actualizado.estado).toBe(
        PedidoEstado.LISTO_PARA_ENTREGAR,
      );
      expect(resultado.promovidos).toEqual([
        {
          id: 'PED-101',
          estado: PedidoEstado.EN_PREPARACION,
          actualizadoEn: expect.any(String),
          mesaNumero: 7,
          lineas: [{ id: 'l-1', nombreSnapshot: 'Chivito', cantidad: 1 }],
        },
      ]);
    });

    it('[TC-U-418] con lugar libre pero sin pedidos en la cola, no promueve ni escribe historial', async () => {
      conLimite(5);
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.EN_PREPARACION,
      });
      tx().usuario.findUnique.mockResolvedValue({ id: USUARIO_ID });
      tx().pedido.update.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.LISTO_PARA_ENTREGAR,
        updatedAt: new Date('2026-11-05T12:05:00Z'),
        mesa: { numero: 4 },
        lineas: [],
      });
      tx().pedido.count.mockResolvedValue(4);
      tx().pedido.findMany.mockResolvedValue([]);

      const resultado = await service.transicionar({
        tenantId: TENANT_ID,
        keycloakId: KEYCLOAK_ID,
        pedidoId: PEDIDO_ID,
        nuevoEstado: PedidoEstado.LISTO_PARA_ENTREGAR,
      });

      expect(resultado.promovidos).toEqual([]);
      expect(tx().pedido.updateMany).not.toHaveBeenCalled();
      expect(tx().pedidoEstadoHistorial.createMany).not.toHaveBeenCalled();
    });

    it('[TC-U-419] estadoCola consulta el estado de la cola dentro del contexto del tenant', async () => {
      const estado = await service.estadoCola(TENANT_ID);

      // Sin límite configurado (mock por defecto): cola desactivada.
      expect(estado).toEqual(
        expect.objectContaining({ activa: false, orden: [] }),
      );
      expect(tx().restaurante.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID } }),
      );
    });

    it('[TC-U-378] al entregar un pedido (LISTO -> ENTREGADO) no se toca la cola: el lugar ya se había liberado', async () => {
      conLimite(5);
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.LISTO_PARA_ENTREGAR,
      });
      tx().usuario.findUnique.mockResolvedValue({ id: USUARIO_ID });
      tx().pedido.update.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.ENTREGADO,
        updatedAt: new Date('2026-11-05T12:10:00Z'),
        mesa: { numero: 4 },
        lineas: [],
      });

      const resultado = await service.transicionar({
        tenantId: TENANT_ID,
        keycloakId: KEYCLOAK_ID,
        pedidoId: PEDIDO_ID,
        nuevoEstado: PedidoEstado.ENTREGADO,
      });

      expect(resultado.promovidos).toEqual([]);
      expect(tx().$executeRaw).not.toHaveBeenCalled();
      expect(tx().pedido.findMany).not.toHaveBeenCalled();
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
          estado: {
            in: [
              PedidoEstado.RECIBIDO,
              PedidoEstado.EN_PREPARACION,
              PedidoEstado.LISTO_PARA_ENTREGAR,
            ],
          },
        },
        select: {
          id: true,
          estado: true,
          createdAt: true,
          observacionGeneral: true,
          codigoRetiro: true,
          retiroNombre: true,
          mesa: { select: { numero: true } },
          lineas: {
            select: {
              id: true,
              nombreSnapshot: true,
              cantidad: true,
              observacion: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      expect(resultado).toEqual([
        {
          id: PEDIDO_ID,
          mesaNumero: 4,
          estado: PedidoEstado.RECIBIDO,
          createdAt: '2026-08-30T12:00:00.000Z',
          retiro: null,
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

  describe('obtenerResumen', () => {
    it('[TC-U-KDS-018] con el pedido encontrado, devuelve id/estado/actualizadoEn (HU-006: seguimiento del comensal)', async () => {
      tx().pedido.findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: PedidoEstado.EN_PREPARACION,
        updatedAt: new Date('2026-08-30T12:00:00Z'),
        mesa: { numero: 4 },
        lineas: [
          {
            id: 'linea-1',
            nombreSnapshot: 'Milanesa a la napolitana',
            cantidad: 2,
          },
        ],
      });

      const resultado = await service.obtenerResumen(TENANT_ID, PEDIDO_ID);

      expect(tx().pedido.findUnique).toHaveBeenCalledWith({
        where: { id: PEDIDO_ID },
        select: {
          id: true,
          estado: true,
          updatedAt: true,
          mesa: { select: { numero: true } },
          lineas: {
            select: { id: true, nombreSnapshot: true, cantidad: true },
          },
        },
      });
      expect(resultado).toEqual({
        id: PEDIDO_ID,
        estado: PedidoEstado.EN_PREPARACION,
        actualizadoEn: '2026-08-30T12:00:00.000Z',
        mesaNumero: 4,
        lineas: [
          {
            id: 'linea-1',
            nombreSnapshot: 'Milanesa a la napolitana',
            cantidad: 2,
          },
        ],
      });
    });

    it('[TC-U-KDS-019] devuelve null si el pedido no existe o es de OTRO tenant (RLS ya lo filtra, no distingue el motivo)', async () => {
      tx().pedido.findUnique.mockResolvedValue(null);

      const resultado = await service.obtenerResumen(
        TENANT_ID,
        'pedido-de-otro-tenant',
      );

      expect(resultado).toBeNull();
    });
  });

  describe('listarSolicitudesEfectivo (BL-448)', () => {
    it('busca pedidos de mesa en PENDIENTE_PAGO con solicitud de efectivo y arma el aviso con total y con cuánto paga', async () => {
      const solicitadoEn = new Date('2026-10-31T23:00:00Z');
      tx().pedido.findMany.mockResolvedValue([
        {
          id: 'pedido-1',
          efectivoSolicitadoEn: solicitadoEn,
          efectivoPagaCon: new Prisma.Decimal('1000'),
          mesa: { id: 'mesa-3', numero: 3 },
          lineas: [
            { subtotal: new Prisma.Decimal('180') },
            { subtotal: new Prisma.Decimal('70.5') },
          ],
        },
        {
          id: 'pedido-2',
          efectivoSolicitadoEn: solicitadoEn,
          efectivoPagaCon: null,
          mesa: { id: 'mesa-5', numero: 5 },
          lineas: [{ subtotal: new Prisma.Decimal('590') }],
        },
      ]);

      const solicitudes = await service.listarSolicitudesEfectivo(TENANT_ID);

      expect(tx().pedido.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            estado: PedidoEstado.PENDIENTE_PAGO,
            canal: 'QR',
            efectivoSolicitadoEn: { not: null },
          },
        }),
      );
      expect(solicitudes).toEqual([
        {
          mesaId: 'mesa-3',
          mesaNumero: 3,
          ts: solicitadoEn.getTime(),
          motivo: 'PAGO_EFECTIVO',
          pedidoId: 'pedido-1',
          total: '250.50',
          pagaCon: '1000.00',
        },
        {
          mesaId: 'mesa-5',
          mesaNumero: 5,
          ts: solicitadoEn.getTime(),
          motivo: 'PAGO_EFECTIVO',
          pedidoId: 'pedido-2',
          total: '590.00',
          pagaCon: null,
        },
      ]);
    });

    it('sin solicitudes pendientes devuelve una lista vacía', async () => {
      tx().pedido.findMany.mockResolvedValue([]);

      await expect(
        service.listarSolicitudesEfectivo(TENANT_ID),
      ).resolves.toEqual([]);
    });
  });

  describe('HU-038 (BL-506): umbrales de espera', () => {
    it('[TC-U-478] devuelve los umbrales del restaurante del tenant, o los de por defecto si no hay restaurante', async () => {
      tx().restaurante.findUnique.mockResolvedValueOnce({
        minutosEsperaAtencion: 20,
        minutosEsperaDemorado: 40,
        minutosEsperaDemoraAlta: 90,
      });

      await expect(service.umbralesEspera(TENANT_ID)).resolves.toEqual({
        atencion: 20,
        demorado: 40,
        demoraAlta: 90,
      });
      expect(tx().restaurante.findUnique).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        select: {
          minutosEsperaAtencion: true,
          minutosEsperaDemorado: true,
          minutosEsperaDemoraAlta: true,
        },
      });

      // Sin restaurante (mock por defecto: null).
      await expect(service.umbralesEspera(TENANT_ID)).resolves.toEqual({
        atencion: 30,
        demorado: 60,
        demoraAlta: 120,
      });
    });
  });
});
