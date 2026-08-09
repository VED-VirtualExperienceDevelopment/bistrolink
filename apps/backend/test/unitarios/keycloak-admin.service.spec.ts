import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { KeycloakAdminService } from '../../src/keycloak-admin/keycloak-admin.service';

describe('KeycloakAdminService', () => {
  let service: KeycloakAdminService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [KeycloakAdminService],
    }).compile();

    service = module.get(KeycloakAdminService);
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
  });
});
