import { KeycloakJwtStrategy, AuthenticatedUser } from '../../src/auth/keycloak-jwt.strategy';
import { UnauthorizedException } from '@nestjs/common';
import { passportJwtSecret } from 'jwks-rsa';

jest.mock('jwks-rsa');

describe('KeycloakJwtStrategy', () => {
  let strategy: KeycloakJwtStrategy;

  beforeAll(() => {
    process.env.KEYCLOAK_URL = 'http://localhost:8080';
    process.env.KEYCLOAK_REALM = 'bistrolink';
  });

  beforeEach(() => {
    (passportJwtSecret as jest.Mock).mockReturnValue({
      jwksUri: 'http://localhost:8080/realms/bistrolink/protocol/openid-connect/certs',
    });
  });

  it('should be defined', () => {
    expect(new KeycloakJwtStrategy()).toBeDefined();
  });

  describe('validate', () => {
    it('should return authenticated user with all required fields', async () => {
      const strategy = new KeycloakJwtStrategy();
      const mockPayload = {
        sub: 'user-123',
        tenant_id: 'tenant-456',
        restaurante_id: 'rest-789',
        realm_access: {
          roles: ['ADMIN', 'MOZO'],
        },
      };

      const result = await strategy.validate(mockPayload);

      expect(result).toEqual({
        sub: 'user-123',
        tenantId: 'tenant-456',
        restauranteId: 'rest-789',
        roles: ['ADMIN', 'MOZO'],
      });
    });

    it('should handle missing restaurante_id gracefully', async () => {
      const strategy = new KeycloakJwtStrategy();
      const mockPayload = {
        sub: 'user-123',
        tenant_id: 'tenant-456',
        realm_access: {
          roles: ['COMENSAL'],
        },
      };

      const result = await strategy.validate(mockPayload);

      expect(result).toEqual({
        sub: 'user-123',
        tenantId: 'tenant-456',
        restauranteId: undefined,
        roles: ['COMENSAL'],
      });
    });

    it('should handle empty roles array', async () => {
      const strategy = new KeycloakJwtStrategy();
      const mockPayload = {
        sub: 'user-123',
        tenant_id: 'tenant-456',
      };

      const result = await strategy.validate(mockPayload);

      expect(result).toEqual({
        sub: 'user-123',
        tenantId: 'tenant-456',
        restauranteId: undefined,
        roles: [],
      });
    });

    it('should throw UnauthorizedException when tenant_id is missing', async () => {
      const strategy = new KeycloakJwtStrategy();
      const mockPayload = {
        sub: 'user-123',
      };

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        'Token sin tenant_id asociado',
      );
    });

    it('should throw UnauthorizedException when tenant_id is null', async () => {
      const strategy = new KeycloakJwtStrategy();
      const mockPayload = {
        sub: 'user-123',
        tenant_id: null,
      };

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should extract roles correctly when realm_access exists', async () => {
      const strategy = new KeycloakJwtStrategy();
      const mockPayload = {
        sub: 'user-123',
        tenant_id: 'tenant-456',
        realm_access: {
          roles: ['ADMIN'],
        },
      };

      const result = await strategy.validate(mockPayload);

      expect(result.roles).toEqual(['ADMIN']);
    });

    it('should return empty array when realm_access is undefined', async () => {
      const strategy = new KeycloakJwtStrategy();
      const mockPayload = {
        sub: 'user-123',
        tenant_id: 'tenant-456',
        realm_access: undefined,
      };

      const result = await strategy.validate(mockPayload);

      expect(result.roles).toEqual([]);
    });
  });
});
