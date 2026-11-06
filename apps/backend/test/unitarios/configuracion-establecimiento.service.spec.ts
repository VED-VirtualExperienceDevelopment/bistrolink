import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CfeProveedor } from '@prisma/client';
import { ConfiguracionEstablecimientoService } from '../../src/configuracion/configuracion-establecimiento.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import { KdsGateway } from '../../src/pedidos/kds.gateway';

/**
 * HU-020 (BL-72): configuración del establecimiento. Lo que se escribe, en
 * qué tabla, y la auditoría en la misma transacción con antes y después.
 */

const TENANT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const ACTOR = { id: 'kc-admin-1' };
const RAZON_SOCIAL = 'Uno SRL';
const RUT = '219999990016';

const RESTAURANTE_ACTUAL = {
  efectivoHabilitado: true,
  mercadoPagoHabilitado: true,
  plexoHabilitado: false,
  handyHabilitado: false,
  propinasSugeridas: [10],
  cfeProveedor: 'SURTEC',
  // HU-042 (BL-465): cola del KDS desactivada.
  limitePedidosEnPreparacion: null,
  umbralAlertaCola: 10,
  minutosPreparacionEstimados: 15,
};

describe('ConfiguracionEstablecimientoService (HU-020, BL-72)', () => {
  let contextos: string[];
  let tx: any;
  let auditLog: { registrarEnTx: jest.Mock };
  let kdsGateway: {
    emitirPedidoActualizado: jest.Mock;
    avisarEstadoCola: jest.Mock;
  };
  let service: ConfiguracionEstablecimientoService;

  beforeEach(() => {
    contextos = [];
    tx = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ razonSocial: RAZON_SOCIAL, rut: RUT }),
        update: jest.fn().mockResolvedValue({}),
      },
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({ ...RESTAURANTE_ACTUAL }),
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...RESTAURANTE_ACTUAL, ...data }),
        ),
      },
      // HU-042 (BL-465): cola del KDS (completarCapacidad).
      pedido: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      pedidoEstadoHistorial: { create: jest.fn(), createMany: jest.fn() },
      $executeRaw: jest.fn(),
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((tenantId: string, fn: any) => {
        contextos.push(tenantId);
        return fn(tx);
      }),
    };
    auditLog = { registrarEnTx: jest.fn().mockResolvedValue(undefined) };
    kdsGateway = {
      emitirPedidoActualizado: jest.fn(),
      avisarEstadoCola: jest.fn().mockResolvedValue(undefined),
    };
    service = new ConfiguracionEstablecimientoService(
      tenantPrisma as unknown as TenantPrismaService,
      auditLog as unknown as AuditLogService,
      kdsGateway as unknown as KdsGateway,
    );
  });

  describe('obtener', () => {
    it('junta los datos fiscales del tenant y la configuración del restaurante, en el contexto del tenant', async () => {
      const configuracion = await service.obtener(TENANT_ID);

      expect(contextos).toEqual([TENANT_ID]);
      expect(configuracion).toEqual({
        razonSocial: RAZON_SOCIAL,
        rut: RUT,
        ...RESTAURANTE_ACTUAL,
        mediosPagoDisponibles: ['EFECTIVO', 'MERCADOPAGO'],
        proveedoresCfeDisponibles: ['SURTEC'],
      });
    });

    it('establecimiento inexistente: 404', async () => {
      tx.tenant.findUnique.mockResolvedValue(null);

      await expect(service.obtener(TENANT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('alta sin restaurante: 409', async () => {
      tx.restaurante.findUnique.mockResolvedValue(null);

      await expect(service.obtener(TENANT_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('actualizar', () => {
    it('sin campos: 400 y no abre la transacción', async () => {
      await expect(
        service.actualizar(TENANT_ID, {}, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(contextos).toEqual([]);
    });

    it('apagar el efectivo y cambiar las propinas: escribe solo eso en restaurante y lo audita con antes y después en la misma transacción', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { efectivoHabilitado: false, propinasSugeridas: [10, 15, 20] },
        ACTOR,
      );

      expect(contextos).toEqual([TENANT_ID]);
      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID },
          data: { efectivoHabilitado: false, propinasSugeridas: [10, 15, 20] },
        }),
      );
      expect(tx.tenant.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.ESTABLECIMIENTO_CONFIGURACION_MODIFICADA,
        tenantId: TENANT_ID,
        actorKeycloakId: ACTOR.id,
        entidadId: TENANT_ID,
        detalle: { campos: ['efectivoHabilitado', 'propinasSugeridas'] },
        antes: { efectivoHabilitado: true, propinasSugeridas: [10] },
        despues: { efectivoHabilitado: false, propinasSugeridas: [10, 15, 20] },
      });
      expect(configuracion.efectivoHabilitado).toBe(false);
      expect(configuracion.propinasSugeridas).toEqual([10, 15, 20]);
    });

    it('razón social: la cambia en tenant y la audita sin el valor', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { razonSocial: 'Uno y Cía SRL' },
        ACTOR,
      );

      expect(tx.tenant.update).toHaveBeenCalledWith({
        where: { id: TENANT_ID },
        data: { razonSocial: 'Uno y Cía SRL' },
      });
      expect(tx.restaurante.update).not.toHaveBeenCalled();
      const [, entrada] = auditLog.registrarEnTx.mock.calls[0];
      expect(entrada.detalle).toEqual({ campos: ['razonSocial'] });
      expect(JSON.stringify(entrada)).not.toContain('Uno');
      expect(configuracion.razonSocial).toBe('Uno y Cía SRL');
      expect(configuracion.rut).toBe(RUT);
    });

    it('HU-036 (BL-206): correo de privacidad: lo guarda en restaurante y lo audita sin el valor', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { emailPrivacidad: 'privacidad@uno.com.uy' },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { emailPrivacidad: 'privacidad@uno.com.uy' },
        }),
      );
      const [, entrada] = auditLog.registrarEnTx.mock.calls[0];
      expect(entrada.detalle).toEqual({ campos: ['emailPrivacidad'] });
      expect(JSON.stringify(entrada)).not.toContain('privacidad@');
      expect(configuracion.emailPrivacidad).toBe('privacidad@uno.com.uy');
    });

    it('el proveedor de CFE queda en el diff', async () => {
      tx.restaurante.findUnique.mockResolvedValue({
        ...RESTAURANTE_ACTUAL,
        cfeProveedor: 'BILLER',
      });

      await service.actualizar(
        TENANT_ID,
        { cfeProveedor: CfeProveedor.SURTEC },
        ACTOR,
      );

      const [, entrada] = auditLog.registrarEnTx.mock.calls[0];
      expect(entrada.antes).toEqual({ cfeProveedor: 'BILLER' });
      expect(entrada.despues).toEqual({ cfeProveedor: 'SURTEC' });
    });

    it('mismos valores que los actuales: no escribe ni audita', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        {
          razonSocial: RAZON_SOCIAL,
          efectivoHabilitado: true,
          propinasSugeridas: [10],
        },
        ACTOR,
      );

      expect(tx.tenant.update).not.toHaveBeenCalled();
      expect(tx.restaurante.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
      expect(configuracion.efectivoHabilitado).toBe(true);
    });

    it('si falla la auditoría, falla el cambio (misma transacción)', async () => {
      auditLog.registrarEnTx.mockRejectedValue(new Error('base caída'));

      await expect(
        service.actualizar(TENANT_ID, { mercadoPagoHabilitado: false }, ACTOR),
      ).rejects.toThrow('base caída');
    });

    it('alta sin restaurante: 409 sin escribir nada', async () => {
      tx.restaurante.findUnique.mockResolvedValue(null);

      await expect(
        service.actualizar(TENANT_ID, { mercadoPagoHabilitado: false }, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.restaurante.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    });
  });
  describe('HU-042 (BL-465): cola del KDS', () => {
    it('[TC-U-401] activar la cola: guarda el límite, lo audita con antes y después y llena la cocina en la misma transacción', async () => {
      // Al escribir el límite, completarCapacidad lo lee de la base.
      tx.restaurante.findUnique
        .mockResolvedValueOnce({ ...RESTAURANTE_ACTUAL })
        .mockResolvedValueOnce({ limitePedidosEnPreparacion: 2 });
      tx.pedido.findMany.mockResolvedValue([
        { id: 'PED-101', mesa: { numero: 3 }, lineas: [] },
      ]);

      const configuracion = await service.actualizar(
        TENANT_ID,
        { limitePedidosEnPreparacion: 2 },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { limitePedidosEnPreparacion: 2 } }),
      );
      const [, entrada] = auditLog.registrarEnTx.mock.calls[0];
      expect(entrada.antes).toEqual({ limitePedidosEnPreparacion: null });
      expect(entrada.despues).toEqual({ limitePedidosEnPreparacion: 2 });
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.pedido.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['PED-101'] }, estado: 'RECIBIDO' },
        data: { estado: 'EN_PREPARACION', updatedAt: expect.any(Date) },
      });
      expect(configuracion.limitePedidosEnPreparacion).toBe(2);
    });

    it('[TC-U-402] después del commit avisa al KDS los pedidos promovidos y el estado de la cola', async () => {
      tx.restaurante.findUnique
        .mockResolvedValueOnce({ ...RESTAURANTE_ACTUAL })
        .mockResolvedValueOnce({ limitePedidosEnPreparacion: 2 });
      tx.pedido.findMany.mockResolvedValue([
        { id: 'PED-101', mesa: { numero: 3 }, lineas: [] },
      ]);

      await service.actualizar(
        TENANT_ID,
        { limitePedidosEnPreparacion: 2 },
        ACTOR,
      );

      expect(kdsGateway.emitirPedidoActualizado).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ id: 'PED-101', estado: 'EN_PREPARACION' }),
      );
      expect(kdsGateway.avisarEstadoCola).toHaveBeenCalledWith(TENANT_ID, {
        forzar: true,
      });
    });

    it('[TC-U-403] desactivar la cola (null): no promueve a nadie y avisa al KDS que se apagó', async () => {
      tx.restaurante.findUnique
        .mockResolvedValueOnce({
          ...RESTAURANTE_ACTUAL,
          limitePedidosEnPreparacion: 5,
        })
        .mockResolvedValueOnce({ limitePedidosEnPreparacion: null });

      await service.actualizar(
        TENANT_ID,
        { limitePedidosEnPreparacion: null },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { limitePedidosEnPreparacion: null } }),
      );
      expect(tx.pedido.updateMany).not.toHaveBeenCalled();
      expect(kdsGateway.emitirPedidoActualizado).not.toHaveBeenCalled();
      expect(kdsGateway.avisarEstadoCola).toHaveBeenCalledWith(TENANT_ID, {
        forzar: true,
      });
    });

    it('[TC-U-404] cambiar solo el umbral o los minutos: no toca la cocina, pero avisa el estado nuevo', async () => {
      await service.actualizar(
        TENANT_ID,
        { umbralAlertaCola: 8, minutosPreparacionEstimados: 20 },
        ACTOR,
      );

      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.pedido.findMany).not.toHaveBeenCalled();
      expect(kdsGateway.avisarEstadoCola).toHaveBeenCalledWith(TENANT_ID, {
        forzar: true,
      });
    });

    it('[TC-U-405] cambiar algo que no es de la cola (propinas) no avisa al KDS', async () => {
      await service.actualizar(
        TENANT_ID,
        { propinasSugeridas: [10, 15] },
        ACTOR,
      );

      expect(kdsGateway.avisarEstadoCola).not.toHaveBeenCalled();
    });
  });
});
