import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
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
        findMany: jest.fn().mockResolvedValue([]),
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
      logoutUser: jest.fn().mockResolvedValue(true),
      resetPassword: jest.fn(),
      actualizarPerfil: jest.fn(),
      findUserById: jest.fn(),
      listarUsuariosDelTenant: jest.fn().mockResolvedValue([]),
      rolesDeRealm: jest.fn().mockResolvedValue([]),
      ultimosIngresos: jest.fn().mockResolvedValue(new Map()),
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
        nombre: 'Juan',
        apellido: 'Pérez',
        rol: 'MOZO',
        restauranteId: RESTAURANTE_ID,
      });

      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'mozo-nuevo',
          tenantId: TENANT_ID,
          // BL-361: nombre y apellido van a Keycloak.
          firstName: 'Juan',
          lastName: 'Pérez',
        }),
      );
      // BL-361: y también a la fila, para el listado.
      expect(tx().usuario.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ nombre: 'Juan', apellido: 'Pérez' }),
      });
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
          nombre: 'Juan',
          apellido: 'Pérez',
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
          nombre: 'Juan',
          apellido: 'Pérez',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_ID,
        }),
      ).rejects.toThrow('Postgres no disponible');

      // Sin esto, "keycloak-id-huerfano" quedaría como identidad en Keycloak
      // sin ninguna fila correspondiente en usuario — invisible para
      // listar()/actualizar()/desactivar().
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
          nombre: 'Juan',
          apellido: 'Pérez',
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
          nombre: 'Juan',
          apellido: 'Pérez',
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
        nombre: 'Juan',
        apellido: 'Pérez',
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
      // Tampoco se cierran sesiones de un usuario que sigue activo.
      expect(keycloakAdmin.logoutUser).not.toHaveBeenCalled();
    });

    it('[TC-U-028] [S] UsuariosService.desactivar cierra las sesiones de Keycloak después de desactivar y lo registra en el audit log (BL-272)', async () => {
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

      expect(keycloakAdmin.logoutUser).toHaveBeenCalledWith('kc-mozo');
      // Orden: primero se impide el login y se marca inactivo en Postgres;
      // recién después se cierran las sesiones abiertas.
      const ordenSetEnabled =
        keycloakAdmin.setEnabled.mock.invocationCallOrder[0];
      const ordenUpdate = tx().usuario.update.mock.invocationCallOrder[0];
      const ordenLogout = keycloakAdmin.logoutUser.mock.invocationCallOrder[0];
      expect(ordenSetEnabled).toBeLessThan(ordenLogout);
      expect(ordenUpdate).toBeLessThan(ordenLogout);

      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_DESACTIVADO,
          detalle: { rol: 'MOZO', sesionesCerradas: true },
        }),
      );
    });

    it('[TC-U-029] UsuariosService.desactivar completa la baja aunque falle el cierre de sesiones, y lo deja en el audit log (BL-272)', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: 'usuario-mozo',
        rol: 'MOZO',
        keycloakId: 'kc-mozo',
      });
      tx().usuario.update.mockResolvedValue({
        id: 'usuario-mozo',
        activo: false,
      });
      keycloakAdmin.logoutUser.mockResolvedValue(false);

      const resultado = await service.desactivar(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        'usuario-mozo',
      );

      // La baja no se deshace: el usuario no puede volver a loguearse y el
      // access token vigente vence solo.
      expect(resultado).toEqual({ desactivado: true, id: 'usuario-mozo' });
      expect(tx().usuario.update).toHaveBeenCalledWith({
        where: { id: 'usuario-mozo' },
        data: { activo: false },
      });
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_DESACTIVADO,
          detalle: { rol: 'MOZO', sesionesCerradas: false },
        }),
      );
    });
  });

  describe('reactivar (BL-358)', () => {
    it('[TC-U-036] UsuariosService.reactivar habilita el usuario en Keycloak, lo marca activo en Postgres y lo audita', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: 'usuario-mozo',
        rol: 'MOZO',
        keycloakId: 'kc-mozo',
        activo: false,
      });
      tx().usuario.update.mockResolvedValue({
        id: 'usuario-mozo',
        activo: true,
      });

      const resultado = await service.reactivar(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        'usuario-mozo',
      );

      expect(keycloakAdmin.setEnabled).toHaveBeenCalledWith('kc-mozo', true);
      expect(tx().usuario.update).toHaveBeenCalledWith({
        where: { id: 'usuario-mozo' },
        data: { activo: true },
      });
      // Mismo orden que la baja: primero Keycloak, después Postgres.
      expect(keycloakAdmin.setEnabled.mock.invocationCallOrder[0]).toBeLessThan(
        tx().usuario.update.mock.invocationCallOrder[0],
      );
      expect(resultado).toEqual({ activo: true, id: 'usuario-mozo' });

      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_REACTIVADO,
          tenantId: TENANT_ID,
          actorKeycloakId: ACTOR_KEYCLOAK_ID,
          targetUsuarioId: 'usuario-mozo',
          detalle: { rol: 'MOZO' },
        }),
      );
      // Reactivar solo suma Admins activos: no consulta la regla RF.19.
      expect(tx().usuario.count).not.toHaveBeenCalled();
    });

    it('[TC-U-037] UsuariosService.reactivar devuelve 404 si el usuario no existe en el tenant', async () => {
      // Bajo RLS, un usuario de otro tenant tampoco aparece.
      tx().usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.reactivar(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          'usuario-de-otro-tenant',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(keycloakAdmin.setEnabled).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-038] UsuariosService.reactivar no marca activo:true en Postgres si Keycloak falla al habilitar', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: 'usuario-mozo',
        rol: 'MOZO',
        keycloakId: 'kc-mozo',
        activo: false,
      });
      keycloakAdmin.setEnabled.mockRejectedValue(
        new Error('Keycloak no disponible'),
      );

      await expect(
        service.reactivar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-mozo'),
      ).rejects.toThrow('Keycloak no disponible');

      // Si Keycloak no lo habilitó, la base no debe mostrarlo como activo.
      expect(tx().usuario.update).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-039] UsuariosService.reactivar no toca Keycloak ni audita si el usuario ya estaba activo', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: 'usuario-mozo',
        rol: 'MOZO',
        keycloakId: 'kc-mozo',
        activo: true,
      });

      const resultado = await service.reactivar(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        'usuario-mozo',
      );

      expect(resultado).toEqual({ activo: true, id: 'usuario-mozo' });
      expect(keycloakAdmin.setEnabled).not.toHaveBeenCalled();
      expect(tx().usuario.update).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });
  });

  describe('restablecerContrasena (BL-359)', () => {
    const mozoActivo = {
      id: 'usuario-mozo',
      rol: 'MOZO',
      keycloakId: 'kc-mozo',
      activo: true,
    };

    it('[TC-U-040] UsuariosService.restablecerContrasena genera una temporal, cierra las sesiones y lo audita sin la contraseña', async () => {
      tx().usuario.findUnique.mockResolvedValue(mozoActivo);

      const resultado = await service.restablecerContrasena(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        'usuario-mozo',
      );

      // Contraseña temporal nueva (16 caracteres, como en el alta).
      expect(resultado.temporaryPassword).toHaveLength(16);
      expect(keycloakAdmin.resetPassword).toHaveBeenCalledWith(
        'kc-mozo',
        resultado.temporaryPassword,
      );

      // Las sesiones se cierran después de cambiar la contraseña.
      expect(keycloakAdmin.logoutUser).toHaveBeenCalledWith('kc-mozo');
      expect(
        keycloakAdmin.resetPassword.mock.invocationCallOrder[0],
      ).toBeLessThan(keycloakAdmin.logoutUser.mock.invocationCallOrder[0]);

      expect(resultado).toEqual({
        id: 'usuario-mozo',
        temporaryPassword: resultado.temporaryPassword,
        sesionesCerradas: true,
      });

      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_CONTRASENA_RESTABLECIDA,
          tenantId: TENANT_ID,
          actorKeycloakId: ACTOR_KEYCLOAK_ID,
          targetUsuarioId: 'usuario-mozo',
          detalle: { rol: 'MOZO', sesionesCerradas: true },
        }),
      );
      // [S] La contraseña no aparece en la auditoría.
      expect(JSON.stringify(auditLog.registrar.mock.calls)).not.toContain(
        resultado.temporaryPassword,
      );
    });

    it('[TC-U-041] UsuariosService.restablecerContrasena genera una contraseña distinta cada vez', async () => {
      tx().usuario.findUnique.mockResolvedValue(mozoActivo);

      const primera = await service.restablecerContrasena(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        'usuario-mozo',
      );
      const segunda = await service.restablecerContrasena(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        'usuario-mozo',
      );

      expect(primera.temporaryPassword).not.toBe(segunda.temporaryPassword);
    });

    it('[TC-U-042] UsuariosService.restablecerContrasena devuelve 404 si el usuario no existe en el tenant', async () => {
      tx().usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.restablecerContrasena(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          'usuario-de-otro-tenant',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(keycloakAdmin.resetPassword).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-043] UsuariosService.restablecerContrasena rechaza con 409 a un usuario desactivado', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        ...mozoActivo,
        activo: false,
      });

      await expect(
        service.restablecerContrasena(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          'usuario-mozo',
        ),
      ).rejects.toThrow(ConflictException);

      expect(keycloakAdmin.resetPassword).not.toHaveBeenCalled();
      expect(keycloakAdmin.logoutUser).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-044] UsuariosService.restablecerContrasena no cierra sesiones ni audita si Keycloak no cambia la contraseña', async () => {
      tx().usuario.findUnique.mockResolvedValue(mozoActivo);
      keycloakAdmin.resetPassword.mockRejectedValue(
        new Error('Keycloak no disponible'),
      );

      await expect(
        service.restablecerContrasena(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          'usuario-mozo',
        ),
      ).rejects.toThrow('Keycloak no disponible');

      expect(keycloakAdmin.logoutUser).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-045] UsuariosService.restablecerContrasena completa el cambio aunque falle el cierre de sesiones, y lo deja en la auditoría', async () => {
      tx().usuario.findUnique.mockResolvedValue(mozoActivo);
      keycloakAdmin.logoutUser.mockResolvedValue(false);

      const resultado = await service.restablecerContrasena(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        'usuario-mozo',
      );

      expect(resultado.sesionesCerradas).toBe(false);
      expect(resultado.temporaryPassword).toHaveLength(16);
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_CONTRASENA_RESTABLECIDA,
          detalle: { rol: 'MOZO', sesionesCerradas: false },
        }),
      );
    });
  });

  describe('cuenta de cocina (BL-362)', () => {
    const COCINA_KC_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
    const COMENSAL_KC_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
    const MOZO_KC_ID = 'cccccccc-3333-4333-8333-333333333333';

    const cuentaCocina = (extra: object = {}) => ({
      id: COCINA_KC_ID,
      username: 'cocina-prueba',
      firstName: 'Cocina',
      lastName: 'BistroLink',
      enabled: true,
      createdTimestamp: 1760000000000,
      attributes: { tenant_id: [TENANT_ID] },
      ...extra,
    });

    // rolesDeRealm según el usuario: solo la cuenta de cocina tiene COCINA.
    const rolesPorUsuario = (id: string) =>
      Promise.resolve(
        id === COCINA_KC_ID
          ? ['COCINA', 'default-roles-bistrolink']
          : ['COMENSAL'],
      );

    it('[TC-U-054] UsuariosService.listar suma la cuenta de cocina del tenant, marcada como compartida', async () => {
      tx().usuario.findMany.mockResolvedValue([
        {
          id: 'usuario-mozo',
          keycloakId: MOZO_KC_ID,
          rol: 'MOZO',
          activo: true,
        },
      ]);
      keycloakAdmin.listarUsuariosDelTenant.mockResolvedValue([
        // El mozo tiene fila: no se vuelve a listar ni se le piden los roles.
        {
          id: MOZO_KC_ID,
          username: 'mozo',
          attributes: { tenant_id: [TENANT_ID] },
        },
        cuentaCocina(),
        // El comensal técnico no tiene fila ni rol COCINA: no se lista.
        {
          id: COMENSAL_KC_ID,
          username: 'comensal',
          attributes: { tenant_id: [TENANT_ID] },
        },
      ]);
      keycloakAdmin.rolesDeRealm.mockImplementation(rolesPorUsuario);

      const resultado = await service.listar(TENANT_ID);

      expect(keycloakAdmin.listarUsuariosDelTenant).toHaveBeenCalledWith(
        TENANT_ID,
      );
      expect(keycloakAdmin.rolesDeRealm).not.toHaveBeenCalledWith(MOZO_KC_ID);
      expect(resultado).toHaveLength(2);
      expect(resultado[0]).toMatchObject({
        id: 'usuario-mozo',
        cuentaCompartida: false,
      });
      expect(resultado[1]).toMatchObject({
        id: COCINA_KC_ID,
        keycloakId: COCINA_KC_ID,
        rol: 'COCINA',
        activo: true,
        cuentaCompartida: true,
        nombre: 'Cocina',
      });
    });

    it('[TC-U-055] UsuariosService.listar no suma cuentas de otro tenant aunque Keycloak las devuelva', async () => {
      keycloakAdmin.listarUsuariosDelTenant.mockResolvedValue([
        cuentaCocina({ attributes: { tenant_id: ['otro-tenant'] } }),
      ]);
      keycloakAdmin.rolesDeRealm.mockImplementation(rolesPorUsuario);

      expect(await service.listar(TENANT_ID)).toEqual([]);
    });

    it('[TC-U-056] UsuariosService.listar devuelve el personal aunque Keycloak no responda', async () => {
      tx().usuario.findMany.mockResolvedValue([
        {
          id: 'usuario-mozo',
          keycloakId: MOZO_KC_ID,
          rol: 'MOZO',
          activo: true,
        },
      ]);
      keycloakAdmin.listarUsuariosDelTenant.mockRejectedValue(
        new Error('Keycloak no disponible'),
      );

      const resultado = await service.listar(TENANT_ID);

      expect(resultado).toEqual([
        expect.objectContaining({
          id: 'usuario-mozo',
          cuentaCompartida: false,
        }),
      ]);
    });

    it('[TC-U-095] UsuariosService.listar arma la cuenta de cocina aunque le falten datos en Keycloak, y descarta usuarios sin tenant_id', async () => {
      keycloakAdmin.listarUsuariosDelTenant.mockResolvedValue([
        // Sin nombre, apellido, correo, enabled ni fecha de alta.
        {
          id: COCINA_KC_ID,
          username: 'cocina-prueba',
          attributes: { tenant_id: [TENANT_ID] },
        },
        // Sin atributos: no se puede saber de qué tenant es, no se lista.
        { id: COMENSAL_KC_ID, username: 'sin-atributos' },
      ]);
      keycloakAdmin.rolesDeRealm.mockResolvedValue(['COCINA']);

      const resultado = await service.listar(TENANT_ID);

      expect(resultado).toEqual([
        expect.objectContaining({
          id: COCINA_KC_ID,
          nombre: null,
          apellido: null,
          email: null,
          activo: true, // enabled ausente no es «desactivado»
          createdAt: null,
          cuentaCompartida: true,
        }),
      ]);
    });

    it('[TC-U-096] UsuariosService.listar devuelve el personal si Keycloak falla con algo que no es un Error', async () => {
      tx().usuario.findMany.mockResolvedValue([
        {
          id: 'usuario-mozo',
          keycloakId: MOZO_KC_ID,
          rol: 'MOZO',
          activo: true,
        },
      ]);
      keycloakAdmin.listarUsuariosDelTenant.mockRejectedValue('timeout');
      keycloakAdmin.ultimosIngresos.mockRejectedValue('timeout');

      const resultado = await service.listar(TENANT_ID);

      expect(resultado).toHaveLength(1);
      expect(resultado[0]).not.toHaveProperty('ultimoIngreso');
    });

    it('[TC-U-057] UsuariosService.restablecerContrasenaCocina cambia la contraseña, cierra las sesiones y lo audita', async () => {
      keycloakAdmin.findUserById.mockResolvedValue(cuentaCocina());
      keycloakAdmin.rolesDeRealm.mockImplementation(rolesPorUsuario);

      const resultado = await service.restablecerContrasenaCocina(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        COCINA_KC_ID,
      );

      expect(resultado.temporaryPassword).toHaveLength(16);
      expect(keycloakAdmin.resetPassword).toHaveBeenCalledWith(
        COCINA_KC_ID,
        resultado.temporaryPassword,
      );
      expect(keycloakAdmin.logoutUser).toHaveBeenCalledWith(COCINA_KC_ID);
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_CONTRASENA_RESTABLECIDA,
          targetUsuarioId: COCINA_KC_ID,
          detalle: {
            rol: 'COCINA',
            cuentaCompartida: true,
            sesionesCerradas: true,
          },
        }),
      );
    });

    it('[TC-U-058] [S] las acciones de cocina responden 404 con una cuenta de otro tenant y no la tocan', async () => {
      keycloakAdmin.findUserById.mockResolvedValue(
        cuentaCocina({ attributes: { tenant_id: ['otro-tenant'] } }),
      );
      keycloakAdmin.rolesDeRealm.mockImplementation(rolesPorUsuario);

      await expect(
        service.restablecerContrasenaCocina(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          COCINA_KC_ID,
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.desactivarCocina(TENANT_ID, ACTOR_KEYCLOAK_ID, COCINA_KC_ID),
      ).rejects.toThrow(NotFoundException);

      expect(keycloakAdmin.resetPassword).not.toHaveBeenCalled();
      expect(keycloakAdmin.setEnabled).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-059] [S] las acciones de cocina responden 404 con una cuenta del tenant que no es de cocina (comensal técnico)', async () => {
      keycloakAdmin.findUserById.mockResolvedValue(
        cuentaCocina({ id: COMENSAL_KC_ID, username: 'comensal' }),
      );
      keycloakAdmin.rolesDeRealm.mockImplementation(rolesPorUsuario);

      await expect(
        service.restablecerContrasenaCocina(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          COMENSAL_KC_ID,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(keycloakAdmin.resetPassword).not.toHaveBeenCalled();
    });

    it('[TC-U-060] UsuariosService.restablecerContrasenaCocina rechaza con 409 una cuenta desactivada', async () => {
      keycloakAdmin.findUserById.mockResolvedValue(
        cuentaCocina({ enabled: false }),
      );
      keycloakAdmin.rolesDeRealm.mockImplementation(rolesPorUsuario);

      await expect(
        service.restablecerContrasenaCocina(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          COCINA_KC_ID,
        ),
      ).rejects.toThrow(ConflictException);
      expect(keycloakAdmin.resetPassword).not.toHaveBeenCalled();
    });

    it('[TC-U-061] UsuariosService.desactivarCocina impide el ingreso, después cierra las sesiones y lo audita', async () => {
      keycloakAdmin.findUserById.mockResolvedValue(cuentaCocina());
      keycloakAdmin.rolesDeRealm.mockImplementation(rolesPorUsuario);

      const resultado = await service.desactivarCocina(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        COCINA_KC_ID,
      );

      expect(resultado).toEqual({ desactivado: true, id: COCINA_KC_ID });
      expect(keycloakAdmin.setEnabled).toHaveBeenCalledWith(
        COCINA_KC_ID,
        false,
      );
      expect(keycloakAdmin.setEnabled.mock.invocationCallOrder[0]).toBeLessThan(
        keycloakAdmin.logoutUser.mock.invocationCallOrder[0],
      );
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_DESACTIVADO,
          detalle: {
            rol: 'COCINA',
            cuentaCompartida: true,
            sesionesCerradas: true,
          },
        }),
      );
    });

    it('[TC-U-062] UsuariosService.reactivarCocina habilita una cuenta desactivada y no hace nada si ya estaba activa', async () => {
      keycloakAdmin.rolesDeRealm.mockImplementation(rolesPorUsuario);

      keycloakAdmin.findUserById.mockResolvedValueOnce(
        cuentaCocina({ enabled: false }),
      );
      await expect(
        service.reactivarCocina(TENANT_ID, ACTOR_KEYCLOAK_ID, COCINA_KC_ID),
      ).resolves.toEqual({ activo: true, id: COCINA_KC_ID });
      expect(keycloakAdmin.setEnabled).toHaveBeenCalledWith(COCINA_KC_ID, true);
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USUARIO_REACTIVADO }),
      );

      keycloakAdmin.setEnabled.mockClear();
      auditLog.registrar.mockClear();
      keycloakAdmin.findUserById.mockResolvedValueOnce(cuentaCocina());
      await service.reactivarCocina(TENANT_ID, ACTOR_KEYCLOAK_ID, COCINA_KC_ID);
      expect(keycloakAdmin.setEnabled).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });
  });

  describe('actualizar: rol (RF.19 al degradar un Admin)', () => {
    it('[TC-U-020] UsuariosService.actualizar rechaza con 409 si se intenta bajar de rol al único Admin', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: ADMIN_A_ID,
        rol: 'ADMIN',
        keycloakId: 'kc-admin-a',
      });
      tx().usuario.count.mockResolvedValue(0);

      await expect(
        service.actualizar(TENANT_ID, ACTOR_KEYCLOAK_ID, ADMIN_A_ID, {
          rol: 'MOZO',
        }),
      ).rejects.toThrow(ConflictException);
      expect(keycloakAdmin.assignRealmRole).not.toHaveBeenCalled();
      expect(tx().usuario.count).toHaveBeenCalledWith({
        where: { rol: 'ADMIN', activo: true, id: { not: ADMIN_A_ID } },
      });
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-021] UsuariosService.actualizar permite bajar de rol a un Admin si existe otro Admin activo, y lo audita', async () => {
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

      const resultado = await service.actualizar(
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

  describe('actualizar: nombre, apellido y correo (BL-366)', () => {
    const mozo = {
      id: 'usuario-mozo',
      rol: 'MOZO',
      keycloakId: 'kc-mozo',
      nombre: 'Juan',
      apellido: 'Pérez',
      email: 'juan@ejemplo.com',
      activo: true,
    };

    it('[TC-U-066] UsuariosService.actualizar cambia en Keycloak y en la fila solo los campos que cambian, y audita cuáles sin los valores', async () => {
      tx().usuario.findUnique.mockResolvedValue(mozo);
      tx().usuario.update.mockResolvedValue({
        ...mozo,
        nombre: 'Juan Carlos',
        email: 'jc@ejemplo.com',
      });

      const resultado = await service.actualizar(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        'usuario-mozo',
        // El apellido viene igual: no cuenta como cambio.
        { nombre: 'Juan Carlos', apellido: 'Pérez', email: 'jc@ejemplo.com' },
      );

      expect(keycloakAdmin.actualizarPerfil).toHaveBeenCalledWith('kc-mozo', {
        firstName: 'Juan Carlos',
        email: 'jc@ejemplo.com',
      });
      expect(keycloakAdmin.assignRealmRole).not.toHaveBeenCalled();
      expect(tx().usuario.update).toHaveBeenCalledWith({
        where: { id: 'usuario-mozo' },
        data: { nombre: 'Juan Carlos', email: 'jc@ejemplo.com' },
      });
      expect(resultado).toMatchObject({
        nombre: 'Juan Carlos',
        cuentaCompartida: false,
      });

      expect(auditLog.registrar).toHaveBeenCalledTimes(1);
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_DATOS_MODIFICADOS,
          targetUsuarioId: 'usuario-mozo',
          detalle: { rol: 'MOZO', campos: ['nombre', 'email'] },
        }),
      );
      // [S] Los valores (datos personales) no van a la auditoría.
      const auditado = JSON.stringify(auditLog.registrar.mock.calls);
      expect(auditado).not.toContain('Juan Carlos');
      expect(auditado).not.toContain('jc@ejemplo.com');
    });

    it('[TC-U-067] UsuariosService.actualizar responde 400 si no hay ningún cambio', async () => {
      tx().usuario.findUnique.mockResolvedValue(mozo);

      await expect(
        service.actualizar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-mozo', {
          rol: 'MOZO',
          nombre: 'Juan',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(keycloakAdmin.actualizarPerfil).not.toHaveBeenCalled();
      expect(tx().usuario.update).not.toHaveBeenCalled();
    });

    it('[TC-U-068] UsuariosService.actualizar no toca la fila ni audita si Keycloak rechaza el correo (ya usado)', async () => {
      tx().usuario.findUnique.mockResolvedValue(mozo);
      keycloakAdmin.actualizarPerfil.mockRejectedValue(
        new ConflictException('Ya hay otro usuario con ese correo'),
      );

      await expect(
        service.actualizar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-mozo', {
          email: 'ocupado@ejemplo.com',
        }),
      ).rejects.toThrow(ConflictException);
      expect(tx().usuario.update).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-069] UsuariosService.actualizar cambia el rol y los datos juntos, con una entrada de auditoría para cada cosa', async () => {
      tx().usuario.findUnique.mockResolvedValue(mozo);
      tx().usuario.update.mockResolvedValue({
        ...mozo,
        rol: 'ADMIN',
        apellido: 'Pérez Núñez',
      });

      await service.actualizar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-mozo', {
        rol: 'ADMIN',
        apellido: 'Pérez Núñez',
      });

      // Primero el perfil (lo que más puede fallar) y después el rol.
      expect(
        keycloakAdmin.actualizarPerfil.mock.invocationCallOrder[0],
      ).toBeLessThan(keycloakAdmin.assignRealmRole.mock.invocationCallOrder[0]);
      expect(tx().usuario.update).toHaveBeenCalledWith({
        where: { id: 'usuario-mozo' },
        data: { rol: 'ADMIN', apellido: 'Pérez Núñez' },
      });
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USUARIO_ROL_MODIFICADO }),
      );
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_DATOS_MODIFICADOS,
          detalle: { rol: 'ADMIN', campos: ['apellido'] },
        }),
      );
    });

    it('[TC-U-070] UsuariosService.actualizar responde 404 con un id sin fila (por ejemplo, la cuenta de cocina)', async () => {
      tx().usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.actualizar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'kc-cocina', {
          nombre: 'Otra',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(keycloakAdmin.actualizarPerfil).not.toHaveBeenCalled();
    });
  });

  describe('cerrar sesiones (BL-367)', () => {
    const COCINA_KC_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

    it('[TC-U-078] UsuariosService.cerrarSesiones cierra las sesiones en Keycloak sin desactivar y lo audita', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: 'usuario-mozo',
        rol: 'MOZO',
        keycloakId: 'kc-mozo',
        activo: true,
      });

      const resultado = await service.cerrarSesiones(
        TENANT_ID,
        ACTOR_KEYCLOAK_ID,
        'usuario-mozo',
      );

      expect(resultado).toEqual({ id: 'usuario-mozo', sesionesCerradas: true });
      expect(keycloakAdmin.logoutUser).toHaveBeenCalledWith('kc-mozo');
      // Sigue activo: no se toca enabled ni la fila.
      expect(keycloakAdmin.setEnabled).not.toHaveBeenCalled();
      expect(tx().usuario.update).not.toHaveBeenCalled();
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_SESIONES_CERRADAS,
          targetUsuarioId: 'usuario-mozo',
          detalle: { rol: 'MOZO' },
        }),
      );
    });

    it('[TC-U-079] UsuariosService.cerrarSesiones devuelve 404 si el usuario no es del tenant', async () => {
      tx().usuario.findUnique.mockResolvedValue(null);

      await expect(
        service.cerrarSesiones(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          'usuario-de-otro-tenant',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(keycloakAdmin.logoutUser).not.toHaveBeenCalled();
    });

    it('[TC-U-080] UsuariosService.cerrarSesiones responde 503 y no audita si Keycloak no cierra las sesiones', async () => {
      tx().usuario.findUnique.mockResolvedValue({
        id: 'usuario-mozo',
        rol: 'MOZO',
        keycloakId: 'kc-mozo',
        activo: true,
      });
      keycloakAdmin.logoutUser.mockResolvedValue(false);

      await expect(
        service.cerrarSesiones(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-mozo'),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('[TC-U-081] UsuariosService.cerrarSesionesCocina cierra las sesiones de la cuenta de cocina del tenant', async () => {
      keycloakAdmin.findUserById.mockResolvedValue({
        id: COCINA_KC_ID,
        username: 'cocina',
        enabled: true,
        attributes: { tenant_id: [TENANT_ID] },
      });
      keycloakAdmin.rolesDeRealm.mockResolvedValue(['COCINA']);

      await expect(
        service.cerrarSesionesCocina(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          COCINA_KC_ID,
        ),
      ).resolves.toEqual({ id: COCINA_KC_ID, sesionesCerradas: true });
      expect(keycloakAdmin.logoutUser).toHaveBeenCalledWith(COCINA_KC_ID);
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_SESIONES_CERRADAS,
          detalle: { rol: 'COCINA', cuentaCompartida: true },
        }),
      );
    });

    it('[TC-U-082] [S] UsuariosService.cerrarSesionesCocina devuelve 404 con una cuenta de otro tenant y no cierra nada', async () => {
      keycloakAdmin.findUserById.mockResolvedValue({
        id: COCINA_KC_ID,
        username: 'cocina',
        attributes: { tenant_id: ['otro-tenant'] },
      });
      keycloakAdmin.rolesDeRealm.mockResolvedValue(['COCINA']);

      await expect(
        service.cerrarSesionesCocina(
          TENANT_ID,
          ACTOR_KEYCLOAK_ID,
          COCINA_KC_ID,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(keycloakAdmin.logoutUser).not.toHaveBeenCalled();
    });
  });

  describe('último ingreso en el listado (BL-368)', () => {
    const MOZO_KC = 'kc-mozo-ingreso';
    const ADMIN_KC = 'kc-admin-ingreso';

    beforeEach(() => {
      tx().usuario.findMany.mockResolvedValue([
        { id: 'usuario-mozo', keycloakId: MOZO_KC, rol: 'MOZO', activo: true },
        {
          id: 'usuario-admin',
          keycloakId: ADMIN_KC,
          rol: 'ADMIN',
          activo: true,
        },
      ]);
    });

    it('[TC-U-086] UsuariosService.listar suma el último ingreso de cada usuario con una sola búsqueda para todo el tenant', async () => {
      const cuando = Date.UTC(2026, 9, 16, 13, 30);
      keycloakAdmin.ultimosIngresos.mockResolvedValue(
        new Map([[MOZO_KC, cuando]]),
      );

      const resultado = await service.listar(TENANT_ID);

      expect(keycloakAdmin.ultimosIngresos).toHaveBeenCalledTimes(1);
      expect(keycloakAdmin.ultimosIngresos).toHaveBeenCalledWith([
        MOZO_KC,
        ADMIN_KC,
      ]);
      expect(resultado).toEqual([
        expect.objectContaining({
          id: 'usuario-mozo',
          ultimoIngreso: '2026-10-16T13:30:00.000Z',
        }),
        // Sin LOGIN en los 90 días que guarda Keycloak.
        expect.objectContaining({ id: 'usuario-admin', ultimoIngreso: null }),
      ]);
    });

    it('[TC-U-087] UsuariosService.listar devuelve el listado sin el último ingreso si Keycloak no lo puede dar', async () => {
      keycloakAdmin.ultimosIngresos.mockRejectedValue(
        new Error('403 sin view-events'),
      );

      const resultado = await service.listar(TENANT_ID);

      expect(resultado).toHaveLength(2);
      // Sin el campo (no null): la pantalla no dice «sin ingresos» por error.
      expect(resultado[0]).not.toHaveProperty('ultimoIngreso');
    });
  });

  describe('el admin no actúa sobre sí mismo (BL-369)', () => {
    const propio = {
      id: 'usuario-propio',
      keycloakId: ACTOR_KEYCLOAK_ID,
      rol: 'ADMIN',
      activo: true,
      nombre: 'Ana',
      apellido: 'Admin',
      email: 'ana@ejemplo.com',
    };

    beforeEach(() => {
      tx().usuario.findUnique.mockResolvedValue(propio);
      // Hay otro Admin: el rechazo no es por RF.19.
      tx().usuario.count.mockResolvedValue(1);
    });

    it('[TC-U-088] [S] UsuariosService.desactivar responde 403 si el admin se desactiva a sí mismo, sin tocar Keycloak, y audita el intento', async () => {
      await expect(
        service.desactivar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-propio'),
      ).rejects.toThrow(ForbiddenException);

      expect(keycloakAdmin.setEnabled).not.toHaveBeenCalled();
      expect(tx().usuario.update).not.toHaveBeenCalled();
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USUARIO_DESACTIVACION_RECHAZADA,
          detalle: { rol: 'ADMIN', motivo: 'propio_usuario' },
        }),
      );
    });

    it('[TC-U-089] [S] UsuariosService.actualizar responde 403 si el admin se cambia su propio rol', async () => {
      await expect(
        service.actualizar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-propio', {
          rol: 'MOZO',
        }),
      ).rejects.toThrow('No podés cambiar tu propio rol');

      expect(keycloakAdmin.assignRealmRole).not.toHaveBeenCalled();
      expect(tx().usuario.update).not.toHaveBeenCalled();
    });

    it('[TC-U-090] UsuariosService.actualizar deja que el admin edite sus propios datos', async () => {
      tx().usuario.update.mockResolvedValue({ ...propio, nombre: 'Ana María' });

      await expect(
        service.actualizar(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-propio', {
          nombre: 'Ana María',
          rol: 'ADMIN', // el mismo rol: no es un cambio
        }),
      ).resolves.toMatchObject({ nombre: 'Ana María' });
      expect(keycloakAdmin.actualizarPerfil).toHaveBeenCalledWith(
        ACTOR_KEYCLOAK_ID,
        { firstName: 'Ana María' },
      );
    });

    it('[TC-U-091] [S] UsuariosService.cerrarSesiones responde 403 sobre las propias sesiones', async () => {
      await expect(
        service.cerrarSesiones(TENANT_ID, ACTOR_KEYCLOAK_ID, 'usuario-propio'),
      ).rejects.toThrow(ForbiddenException);

      expect(keycloakAdmin.logoutUser).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });
  });
});
