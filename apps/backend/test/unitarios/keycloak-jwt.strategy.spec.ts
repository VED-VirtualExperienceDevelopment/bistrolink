import { KeycloakJwtStrategy } from '../../src/auth/keycloak-jwt.strategy';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { passportJwtSecret } from 'jwks-rsa';
import {
  CODIGO_ESTABLECIMIENTO_SUSPENDIDO,
  errorEstablecimientoSuspendido,
  MENSAJE_SUSPENDIDO_COMENSAL,
  MENSAJE_SUSPENDIDO_PERSONAL,
  TenantEstadoService,
} from '../../src/tenant-estado/tenant-estado.service';

jest.mock('jwks-rsa');

// BL-413: estado del establecimiento. Por defecto activo; los tests de
// suspensión lo cambian.
const tenantEstado = { asegurarActivo: jest.fn() };
const crearEstrategia = () =>
  new KeycloakJwtStrategy(tenantEstado as unknown as TenantEstadoService);

describe('KeycloakJwtStrategy', () => {
  beforeAll(() => {
    process.env.KEYCLOAK_URL = 'http://localhost:8080';
    process.env.KEYCLOAK_REALM = 'bistrolink';
  });

  beforeEach(() => {
    tenantEstado.asegurarActivo.mockReset().mockResolvedValue(undefined);
    (passportJwtSecret as jest.Mock).mockReturnValue({
      jwksUri:
        'http://localhost:8080/realms/bistrolink/protocol/openid-connect/certs',
    });
  });

  it('should be defined', () => {
    expect(crearEstrategia()).toBeDefined();
  });

  describe('validate', () => {
    it('should return authenticated user with all required fields', async () => {
      const strategy = crearEstrategia();
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
      const strategy = crearEstrategia();
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
      const strategy = crearEstrategia();
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
      const strategy = crearEstrategia();
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
      const strategy = crearEstrategia();
      const mockPayload = {
        sub: 'user-123',
        tenant_id: null,
      };

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should extract roles correctly when realm_access exists', async () => {
      const strategy = crearEstrategia();
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
      const strategy = crearEstrategia();
      const mockPayload = {
        sub: 'user-123',
        tenant_id: 'tenant-456',
        realm_access: undefined,
      };

      const result = await strategy.validate(mockPayload);

      expect(result.roles).toEqual([]);
    });
    describe('BL-413: establecimiento suspendido', () => {
      const suspender = () =>
        tenantEstado.asegurarActivo.mockImplementation(
          (_tenantId: string, mensaje: string) =>
            Promise.reject(errorEstablecimientoSuspendido(mensaje)),
        );

      it('[TC-U-119] consulta el estado del tenant del token y deja pasar uno activo', async () => {
        const strategy = crearEstrategia();

        await strategy.validate({
          sub: 'user-123',
          tenant_id: 'tenant-456',
          realm_access: { roles: ['MOZO'] },
        });

        expect(tenantEstado.asegurarActivo).toHaveBeenCalledWith(
          'tenant-456',
          MENSAJE_SUSPENDIDO_PERSONAL,
        );
      });

      it.each(['ADMIN', 'MOZO', 'COCINA'])(
        '[TC-U-120] rechaza con 403 y el código ESTABLECIMIENTO_SUSPENDIDO un token %s',
        async (rol) => {
          suspender();
          const strategy = crearEstrategia();

          const error = await strategy
            .validate({
              sub: 'user-123',
              tenant_id: 'tenant-456',
              realm_access: { roles: [rol] },
            })
            .catch((e: unknown) => e);

          expect(error).toBeInstanceOf(ForbiddenException);
          expect((error as ForbiddenException).getResponse()).toEqual(
            expect.objectContaining({
              message: MENSAJE_SUSPENDIDO_PERSONAL,
              codigo: CODIGO_ESTABLECIMIENTO_SUSPENDIDO,
            }),
          );
        },
      );

      it('[TC-U-121] al comensal le responde «no disponible», sin el mensaje para el personal', async () => {
        suspender();
        const strategy = crearEstrategia();

        await expect(
          strategy.validate({
            sub: 'comensal-tecnico',
            tenant_id: 'tenant-456',
            realm_access: { roles: ['COMENSAL'] },
          }),
        ).rejects.toThrow(MENSAJE_SUSPENDIDO_COMENSAL);
      });

      it('no consulta el estado si el token no tiene tenant_id (sigue siendo 401)', async () => {
        const strategy = crearEstrategia();

        await expect(strategy.validate({ sub: 'user-123' })).rejects.toThrow(
          UnauthorizedException,
        );
        expect(tenantEstado.asegurarActivo).not.toHaveBeenCalled();
      });
    });
  });
});
