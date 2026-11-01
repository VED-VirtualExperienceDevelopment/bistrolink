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
  plexoHabilitado: true,
  handyHabilitado: false,
  propinasSugeridas: [10],
  cfeProveedor: 'SURTEC',
};

describe('ConfiguracionEstablecimientoService (HU-020, BL-72)', () => {
  let contextos: string[];
  let tx: any;
  let auditLog: { registrarEnTx: jest.Mock };
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
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((tenantId: string, fn: any) => {
        contextos.push(tenantId);
        return fn(tx);
      }),
    };
    auditLog = { registrarEnTx: jest.fn().mockResolvedValue(undefined) };
    service = new ConfiguracionEstablecimientoService(
      tenantPrisma as unknown as TenantPrismaService,
      auditLog as unknown as AuditLogService,
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
        service.actualizar(TENANT_ID, { plexoHabilitado: false }, ACTOR),
      ).rejects.toThrow('base caída');
    });

    it('alta sin restaurante: 409 sin escribir nada', async () => {
      tx.restaurante.findUnique.mockResolvedValue(null);

      await expect(
        service.actualizar(TENANT_ID, { handyHabilitado: true }, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.restaurante.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    });
  });
});
