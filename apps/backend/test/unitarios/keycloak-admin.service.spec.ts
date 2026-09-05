import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { KeycloakAdminService } from '../../src/keycloak-admin/keycloak-admin.service';

describe('KeycloakAdminService', () => {
  let service: KeycloakAdminService;
  let fetchMock: jest.Mock;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    // Silenciamos y capturamos los logs reales para poder asertar tanto el
    // contenido (status/body presentes) como la ausencia de PII (username,
    // email) en los casos donde no deberían aparecer.
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [KeycloakAdminService],
    }).compile();

    service = module.get(KeycloakAdminService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Toda llamada admin primero pide un token — este helper mockea esa
  // primera respuesta para poder enfocar cada test en la segunda (la real).
  const mockTokenRequest = () =>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'fake-admin-token' }),
    });

  describe('createUser', () => {
    it('[TC-U-002] KeycloakAdminService.createUser lanza ConflictException si Keycloak devuelve 409 (username/email duplicado)', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 409,
        ok: false,
        text: async () => 'User exists with same username',
      });

      await expect(
        service.createUser({
          username: 'ya-existe',
          tenantId: 'tenant-1',
          temporaryPassword: 'temp123',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('[TC-U-003] KeycloakAdminService.createUser lanza InternalServerErrorException ante otros errores de Keycloak', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 500,
        ok: false,
        text: async () => 'Internal error',
      });

      await expect(
        service.createUser({
          username: 'algun-usuario',
          tenantId: 'tenant-1',
          temporaryPassword: 'temp123',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('[TC-U-004] KeycloakAdminService.createUser devuelve el keycloakId cuando la creación es exitosa (201)', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 201,
        ok: true,
        headers: {
          get: (name: string) =>
            name === 'Location'
              ? 'http://localhost:8080/admin/realms/bistrolink/users/nuevo-id'
              : null,
        },
      });

      const keycloakId = await service.createUser({
        username: 'usuario-nuevo',
        tenantId: 'tenant-1',
        temporaryPassword: 'temp123',
      });

      expect(keycloakId).toBe('nuevo-id');
    });

    it('[TC-U-005] KeycloakAdminService.createUser lanza InternalServerErrorException con mensaje de permisos si Keycloak devuelve 403', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 403,
        ok: false,
        text: async () => 'Forbidden',
      });

      await expect(
        service.createUser({
          username: 'usuario-cualquiera',
          tenantId: 'tenant-1',
          temporaryPassword: 'temp123',
        }),
      ).rejects.toThrow(/manage-users/);
    });

    it('[TC-U-006] [S] KeycloakAdminService.createUser NUNCA loguea username/email, ni en el caso de éxito ni de error (RD.07)', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 409,
        ok: false,
        text: async () => 'User exists with same username',
      });

      await expect(
        service.createUser({
          username: 'usuario-secreto',
          email: 'persona-real@ejemplo.com',
          tenantId: 'tenant-1',
          temporaryPassword: 'temp123',
        }),
      ).rejects.toThrow(ConflictException);

      const todosLosLogs = [
        ...loggerErrorSpy.mock.calls,
        ...loggerWarnSpy.mock.calls,
      ]
        .flat()
        .join(' ');
      expect(todosLosLogs).not.toContain('usuario-secreto');
      expect(todosLosLogs).not.toContain('persona-real@ejemplo.com');
    });
  });

  describe('getAdminToken (a través de una llamada admin cualquiera)', () => {
    it('[TC-U-007] lanza InternalServerErrorException con mensaje específico si Keycloak rechaza las credenciales del service account (401)', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 401,
        ok: false,
        text: async () => 'invalid_client',
      });

      await expect(
        service.createUser({
          username: 'no-importa',
          tenantId: 'tenant-1',
          temporaryPassword: 'temp123',
        }),
      ).rejects.toThrow(/KEYCLOAK_CLIENT_ID|KEYCLOAK_CLIENT_SECRET/);

      // Solo debió intentarse la request de token — nunca debería llegar a
      // pedir /users si ni siquiera consiguió autenticarse.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('[TC-U-008] lanza InternalServerErrorException genérico (con status/body) si Keycloak falla al emitir el token por otro motivo', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 503,
        ok: false,
        text: async () => 'Service Unavailable',
      });

      await expect(
        service.createUser({
          username: 'no-importa',
          tenantId: 'tenant-1',
          temporaryPassword: 'temp123',
        }),
      ).rejects.toThrow(/503/);
    });
  });

  describe('assignRealmRole', () => {
    it('[TC-U-009] lanza InternalServerErrorException mencionando realm-export.json si el rol no existe en Keycloak (404)', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 404,
        ok: false,
        text: async () => 'Role not found',
      });

      await expect(
        service.assignRealmRole('keycloak-id-123', 'ROL_INEXISTENTE'),
      ).rejects.toThrow(/realm-export\.json/);
    });

    it('[TC-U-010] [S] lanza InternalServerErrorException mencionando BL-162/view-realm si al service account le falta el permiso (403)', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 403,
        ok: false,
        text: async () => 'Forbidden',
      });

      await expect(
        service.assignRealmRole('keycloak-id-123', 'MOZO'),
      ).rejects.toThrow(/view-realm/);
    });

    it('[TC-U-010b] lanza InternalServerErrorException genérico (con status/body) si el GET del rol falla por un motivo distinto a 403/404', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 503,
        ok: false,
        text: async () => 'Service Unavailable',
      });

      await expect(
        service.assignRealmRole('keycloak-id-123', 'MOZO'),
      ).rejects.toThrow(/503/);
    });

    it('[TC-U-011] resuelve sin lanzar cuando el rol existe y la asignación es exitosa', async () => {
      mockTokenRequest(); // token para el GET /roles/:roleName
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'role-uuid-mozo', name: 'MOZO' }),
      });
      mockTokenRequest(); // token para el POST /role-mappings/realm
      fetchMock.mockResolvedValueOnce({
        ok: true,
      });

      await expect(
        service.assignRealmRole('keycloak-id-123', 'MOZO'),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('[TC-U-012] si falla el paso de asignación (POST role-mappings) pese a que el rol existe: lanza con status/body y loguea el keycloakId para auditar', async () => {
      mockTokenRequest(); // token para el GET /roles/:roleName
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'role-uuid-mozo', name: 'MOZO' }),
      });
      mockTokenRequest(); // token para el POST /role-mappings/realm
      fetchMock.mockResolvedValueOnce({
        status: 500,
        ok: false,
        text: async () => 'Internal error asignando el rol',
      });

      await expect(
        service.assignRealmRole('keycloak-id-para-auditar', 'MOZO'),
      ).rejects.toThrow(/500/);

      // [S] El keycloakId sí se loguea acá -- no es PII, es la referencia
      // que necesitamos para encontrar al usuario y auditar/diagnosticar.
      const todosLosLogs = loggerErrorSpy.mock.calls.flat().join(' ');
      expect(todosLosLogs).toContain('keycloak-id-para-auditar');
    });
  });

  describe('createUser - caso sin header Location', () => {
    it('[TC-U-014] lanza InternalServerErrorException y loguea el error si Keycloak responde 201 sin header Location', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 201,
        ok: true,
        headers: {
          get: () => null, // sin Location
        },
      });

      await expect(
        service.createUser({
          username: 'usuario-sin-location',
          tenantId: 'tenant-1',
          temporaryPassword: 'temp123',
        }),
      ).rejects.toThrow('Keycloak no devolvió el ID del usuario creado');

      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe('setEnabled', () => {
    it('[TC-U-015] resuelve sin lanzar cuando Keycloak confirma el cambio de estado (200)', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({ ok: true });

      await expect(
        service.setEnabled('keycloak-id-123', false),
      ).resolves.toBeUndefined();
    });

    it('[TC-U-016] lanza InternalServerErrorException con status/body y loguea el keycloakId si Keycloak rechaza el cambio de estado', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 404,
        ok: false,
        text: async () => 'User not found',
      });

      await expect(
        service.setEnabled('keycloak-id-para-auditar', false),
      ).rejects.toThrow(/404/);

      const todosLosLogs = loggerErrorSpy.mock.calls.flat().join(' ');
      expect(todosLosLogs).toContain('keycloak-id-para-auditar');
    });
  });

  describe('deleteUser', () => {
    it('[TC-U-017] resuelve sin lanzar cuando Keycloak confirma la eliminación (204)', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({ ok: true });

      await expect(
        service.deleteUser('keycloak-id-123'),
      ).resolves.toBeUndefined();
    });

    it('[TC-U-018] [S] lanza InternalServerErrorException y loguea el keycloakId si falla la eliminación (limpieza de compensación fallida)', async () => {
      mockTokenRequest();
      fetchMock.mockResolvedValueOnce({
        status: 500,
        ok: false,
        text: async () => 'Internal error',
      });

      await expect(service.deleteUser('keycloak-id-huerfano')).rejects.toThrow(
        /500/,
      );

      // Este es justo el caso que usuarios.service.ts necesita poder
      // encontrar en Loki para la limpieza manual del usuario huérfano.
      const todosLosLogs = loggerErrorSpy.mock.calls.flat().join(' ');
      expect(todosLosLogs).toContain('keycloak-id-huerfano');
    });
  });
});
