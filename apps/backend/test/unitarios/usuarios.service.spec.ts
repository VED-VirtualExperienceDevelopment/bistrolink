import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UsuariosService } from '../../src/usuarios/usuarios.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { KeycloakAdminService } from '../../src/keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

const TENANT_ID = '554915d0-f7ed-4053-b841-56479df29fd9';
const RESTAURANTE_ID = '87152395-a721-4651-99b8-f21075d1d8ae';
const ADMIN_A_ID = 'usuario-admin-a';
const ACTOR_KEYCLOAK_ID = 'kc-actor-admin'; // quien ejecuta la acción, no el target

describe('UsuariosService', () => {
  let service: UsuariosService;
  let keycloakAdmin: jest.Mocked<KeycloakAdminService>;
  let auditLog: jest.Mocked<AuditLogService>;

  // Helper: simula runInTenantContext ejecutando directamente el callback
  // con un mock de "tx" (el cliente de Prisma dentro de la transacción).
  const runInTenantContextMock = (tx: any) =>
    jest.fn((tenantId: string, fn: (tx: any) => any) => fn(tx));

  beforeEach(async () => {
    const tx = {
      restaurante: { findUnique: jest.fn() },
      usuario: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      // Usado por lockTenant() para el advisory lock (pg_advisory_xact_lock).
      $executeRawUnsafe: jest.fn(),
    };

    const tenantPrismaMock = {
      runInTenantContext: runInTenantContextMock(tx),
    };

    const keycloakAdminMock = {
      createUser: jest.fn(),
      assignRealmRole: jest.fn(),
      setEnabled: jest.fn(),
      deleteUser: jest.fn(),
    };

    const auditLogMock = {
      registrar: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsuariosService,
        { provide: TenantPrismaService, useValue: tenantPrismaMock },
        { provide: KeycloakAdminService, useValue: keycloakAdminMock },
        { provide: AuditLogService, useValue: auditLogMock },
      ],
    }).compile();

    service = module.get(UsuariosService);
    keycloakAdmin = module.get(KeycloakAdminService);
    auditLog = module.get(AuditLogService);

    // Exponemos el mock de "tx" en el test vía closure — se referencia abajo
    // a través de (tenantPrisma.runInTenantContext as jest.Mock).mock, pero
    // es más simple guardarlo en una variable de módulo para reconfigurar
    // sus retornos en cada test.
    (service as any).__tx = tx;
  });

  const tx = () => (service as any).__tx;

  describe('crear', () => {
    it('[TC-U-008] UsuariosService.crear crea el usuario cuando el restaurante pertenece al tenant', async () => {
      tx().restaurante.findUnique.mockResolvedValue({
        id: RESTAURANTE_ID,
        tenantId: TENANT_ID,
      });
      keycloakAdmin.createUser.mockResolvedValue('keycloak-id-nuevo');
      tx().usuario.create.mockResolvedValue({
        id: 'usuario-nuevo',
        tenantId: TENANT_ID,
        restauranteId: RESTAURANTE_ID,
        keycloakId: 'keycloak-id-nuevo',
        rol: 'MOZO',
      });

      const resultado = await service.crear(TENANT_ID, ACTOR_KEYCLOAK_ID, {
        username: 'mozo-nuevo',
        rol: 'MOZO',
        restauranteId: RESTAURANTE_ID,
      });

      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'mozo-nuevo',
          tenantId: TENANT_ID,
        }),
      );
      expect(keycloakAdmin.assignRealmRole).toHaveBeenCalledWith(
        'keycloak-id-nuevo',
        'MOZO',
      );
      expect(resultado.temporaryPassword).toBeDefined();
    });

    it('[TC-U-009] UsuariosService.crear rechaza con 403 si el restaurante no pertenece al tenant', async () => {
      // RLS ya filtra esta query — si el restaurante es de otro tenant,
      // simplemente no aparece, y el mock lo simula devolviendo null.
      tx().restaurante.findUnique.mockResolvedValue(null);

      await expect(
        service.crear(TENANT_ID, ACTOR_KEYCLOAK_ID, {
          username: 'intento-cruzado',
          rol: 'MOZO',
          restauranteId: 'restaurante-de-otro-tenant',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(keycloakAdmin.createUser).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-010] UsuariosService.crear revierte el usuario en Keycloak si falla la creación en Postgres', async () => {
      tx().restaurante.findUnique.mockResolvedValue({
        id: RESTAURANTE_ID,
        tenantId: TENANT_ID,
      });
      keycloakAdmin.createUser.mockResolvedValue('keycloak-id-huerfano');
      tx().usuario.create.mockRejectedValue(
        new Error('Postgres no disponible'),
      );

      await expect(
        service.crear(TENANT_ID, ACTOR_KEYCLOAK_ID, {
          username: 'mozo-nuevo',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_ID,
        }),
      ).rejects.toThrow('Postgres no disponible');

      // Sin esto, "keycloak-id-huerfano" quedaría como identidad en Keycloak
      // sin ninguna fila correspondiente en usuario — invisible para
      // listar()/actualizarRol()/desactivar().
      expect(keycloakAdmin.deleteUser).toHaveBeenCalledWith(
        'keycloak-id-huerfano',
      );
      // No hubo alta real → no debe quedar auditada como si hubiera ocurrido.
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-011] UsuariosService.crear revierte el usuario en Keycloak si falla assignRealmRole', async () => {
      tx().restaurante.findUnique.mockResolvedValue({
        id: RESTAURANTE_ID,
        tenantId: TENANT_ID,
      });
      keycloakAdmin.createUser.mockResolvedValue('keycloak-id-huerfano');
      keycloakAdmin.assignRealmRole.mockRejectedValue(
        new Error('Keycloak no disponible'),
      );

      await expect(
        service.crear(TENANT_ID, ACTOR_KEYCLOAK_ID, {
          username: 'mozo-nuevo',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_ID,
        }),
      ).rejects.toThrow('Keycloak no disponible');

      expect(keycloakAdmin.deleteUser).toHaveBeenCalledWith(
        'keycloak-id-huerfano',
      );
      expect(tx().usuario.create).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-012] UsuariosService.crear no oculta el error original aunque la compensación también falle', async () => {
      tx().restaurante.findUnique.mockResolvedValue({
        id: RESTAURANTE_ID,
        tenantId: TENANT_ID,
      });
      keycloakAdmin.createUser.mockResolvedValue('keycloak-id-huerfano');
      tx().usuario.create.mockRejectedValue(
        new Error('Postgres no disponible'),
      );
      keycloakAdmin.deleteUser.mockRejectedValue(
        new Error('Keycloak tampoco responde'),
      );

      // El error que debe ver quien hizo el request es el original de
      // Postgres, no el de la compensación fallida.
      await expect(
        service.crear(TENANT_ID, ACTOR_KEYCLOAK_ID, {
          username: 'mozo-nuevo',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_ID,
        }),
      ).rejects.toThrow('Postgres no disponible');
    });

    it('[HU-013 DoD] audita el alta de una cuenta Administrador con el actor y el rol', async () => {
      tx().restaurante.findUnique.mockResolvedValue({
        id: RESTAURANTE_ID,
        tenantId: TENANT_ID,
      });
      keycloakAdmin.createUser.mockResolvedValue('keycloak-id-admin-nuevo');
      tx().usuario.create.mockResolvedValue({
        id: 'usuario-admin-nuevo',
        tenantId: TENANT_ID,
        restauranteId: RESTAURANTE_ID,
        keycloakId: 'keycloak-id-admin-nuevo',
        rol: 'ADMIN',
      });

      await service.crear(TENANT_ID, ACTOR_KEYCLOAK_ID, {
        username: 'admin-nuevo',
        rol: 'ADMIN',
        restauranteId: RESTAURANTE_ID,
      });

      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_CREADO,
          tenantId: TENANT_ID,
          actorKeycloakId: ACTOR_KEYCLOAK_ID,
          targetUsuarioId: 'usuario-admin-nuevo',
          detalle: expect.objectContaining({ rol: 'ADMIN' }),
        }),
      );
    });
  });

  describe('desactivar (RF.19)', () => {
    it('[TC-U-014] UsuariosService.desactivar rechaza con 409 si es el único Admin del tenant, y audita el intento', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: ADMIN_A_ID,
        rol: 'ADMIN',
        keycloakId: 'kc-admin-a',
      });
      tx().usuario.count.mockResolvedValue(0); // no quedan otros Admins

      await expect(
        service.desactivar(TENANT_ID, ACTOR_KEYCLOAK_ID, ADMIN_A_ID),
      ).rejects.toThrow(ConflictException);
      expect(keycloakAdmin.setEnabled).not.toHaveBeenCalled();

      // [HU-013 DoD] el intento rechazado también es un evento auditable:
      // alguien intentó dejar el tenant sin ningún Administrador.
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_DESACTIVACION_RECHAZADA,
          tenantId: TENANT_ID,
          actorKeycloakId: ACTOR_KEYCLOAK_ID,
          targetUsuarioId: ADMIN_A_ID,
        }),
      );
    });

    it('[TC-U-015] UsuariosService.desactivar el conteo de RF.19 excluye Admins ya desactivados (activo:false)', async () => {
      // Regresión del bug encontrado en auditoría: sin el filtro activo:true,
      // un Admin ya deshabilitado en una operación previa seguía contando
      // como "Admin disponible" para la siguiente desactivación/degradación,
      // permitiendo dejar el tenant sin ningún Admin habilitado.
      tx().usuario.findUnique.mockResolvedValue({
        id: ADMIN_A_ID,
        rol: 'ADMIN',
        keycloakId: 'kc-admin-a',
      });
      tx().usuario.count.mockResolvedValue(0);

      await expect(
        service.desactivar(TENANT_ID, ACTOR_KEYCLOAK_ID, ADMIN_A_ID),
      ).rejects.toThrow(ConflictException);

      expect(tx().usuario.count).toHaveBeenCalledWith({
        where: { rol: 'ADMIN', activo: true, id: { not: ADMIN_A_ID } },
      });
    });

    it('[TC-U-016] UsuariosService.desactivar permite desactivar un Admin si existe al menos otro Admin activo, y lo audita', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: ADMIN_A_ID,
        rol: 'ADMIN',
        keycloakId: 'kc-admin-a',
      });
      tx().usuario.count.mockResolvedValue(1); // queda ADMIN_B_ID
      tx().usuario.update.mockResolvedValue({
        id: ADMIN_A_ID,
        activo: false,
      });

      const resultado = await service.desactivar(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        ADMIN_A_ID,
      );

      expect(keycloakAdmin.setEnabled).toHaveBeenCalledWith(
        'kc-admin-a',
        false,
      );
      // RF.19 se apoya en este campo para contar Admins realmente activos —
      // sin este update, la fila queda con rol: 'ADMIN' para siempre y el
      // conteo de asegurarNoEsUltimoAdmin no lo distingue de uno habilitado.
      expect(tx().usuario.update).toHaveBeenCalledWith({
        where: { id: ADMIN_A_ID },
        data: { activo: false },
      });
      expect(resultado).toEqual({ desactivado: true, id: ADMIN_A_ID });

      // [HU-013 DoD] baja de cuenta Administrador auditada en Pino/INFO.
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_DESACTIVADO,
          tenantId: TENANT_ID,
          actorKeycloakId: ACTOR_KEYCLOAK_ID,
          targetUsuarioId: ADMIN_A_ID,
          detalle: expect.objectContaining({ rol: 'ADMIN' }),
        }),
      );
    });

    it('[TC-U-017] UsuariosService.desactivar permite desactivar un Mozo sin verificar la regla de Admins', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: 'usuario-mozo',
        rol: 'MOZO',
        keycloakId: 'kc-mozo',
      });
      tx().usuario.update.mockResolvedValue({
        id: 'usuario-mozo',
        activo: false,
      });

      await service.desactivar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-mozo');

      // La regla RF.19 solo aplica a ADMIN — no debería ni consultar el count.
      expect(tx().usuario.count).not.toHaveBeenCalled();
      expect(keycloakAdmin.setEnabled).toHaveBeenCalledWith('kc-mozo', false);
      expect(tx().usuario.update).toHaveBeenCalledWith({
        where: { id: 'usuario-mozo' },
        data: { activo: false },
      });
    });

    it('[TC-U-018] UsuariosService.desactivar devuelve 404 si el usuario no existe en el tenant', async () => {
      tx().usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.desactivar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-inexistente'),
      ).rejects.toThrow(NotFoundException);
    });

    it('[TC-U-019] UsuariosService.desactivar no marca activo:false en Postgres si Keycloak falla al desactivar', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: 'usuario-mozo',
        rol: 'MOZO',
        keycloakId: 'kc-mozo',
      });
      keycloakAdmin.setEnabled.mockRejectedValue(
        new Error('Keycloak no disponible'),
      );

      await expect(
        service.desactivar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-mozo'),
      ).rejects.toThrow('Keycloak no disponible');

      // Si Keycloak falla, el usuario sigue habilitado en la realidad —
      // Postgres no debe quedar desincronizado marcándolo inactivo igual.
      expect(tx().usuario.update).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });
  });

  describe('actualizarRol (RF.19 al degradar un Admin)', () => {
    it('[TC-U-020] UsuariosService.actualizarRol rechaza con 409 si se intenta bajar de rol al único Admin', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: ADMIN_A_ID,
        rol: 'ADMIN',
        keycloakId: 'kc-admin-a',
      });
      tx().usuario.count.mockResolvedValue(0);

      await expect(
        service.actualizarRol(TENANT_ID, ACTOR_KEYCLOAK_ID, ADMIN_A_ID, {
          rol: 'MOZO',
        }),
      ).rejects.toThrow(ConflictException);
      expect(keycloakAdmin.assignRealmRole).not.toHaveBeenCalled();
      expect(tx().usuario.count).toHaveBeenCalledWith({
        where: { rol: 'ADMIN', activo: true, id: { not: ADMIN_A_ID } },
      });
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-021] UsuariosService.actualizarRol permite bajar de rol a un Admin si existe otro Admin activo, y lo audita', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: ADMIN_A_ID,
        rol: 'ADMIN',
        keycloakId: 'kc-admin-a',
      });
      tx().usuario.count.mockResolvedValue(1);
      tx().usuario.update.mockResolvedValue({
        id: ADMIN_A_ID,
        rol: 'MOZO',
      });

      const resultado = await service.actualizarRol(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        ADMIN_A_ID,
        { rol: 'MOZO' },
      );

      expect(keycloakAdmin.assignRealmRole).toHaveBeenCalledWith(
        'kc-admin-a',
        'MOZO',
      );
      expect(resultado.rol).toBe('MOZO');

      // [HU-013 DoD] cambio de rol auditado con rol anterior y nuevo.
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_ROL_MODIFICADO,
          tenantId: TENANT_ID,
          actorKeycloakId: ACTOR_KEYCLOAK_ID,
          targetUsuarioId: ADMIN_A_ID,
          detalle: { rolAnterior: 'ADMIN', rolNuevo: 'MOZO' },
        }),
      );
    });
  });
});
