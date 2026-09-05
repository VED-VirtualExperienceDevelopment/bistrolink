import * as jwt from 'jsonwebtoken';
import { WsAuthService, WsAuthError } from '../../src/pedidos/ws-auth.service';

// jwks-rsa y jsonwebtoken se mockean por completo: este test verifica la
// LOGICA de WsAuthService (que rechace lo que debe rechazar, que arme bien
// el objeto de claims), no la criptografia real de verificacion de firma
// -- eso ya lo cubre la libreria en si, y probarlo de nuevo aca solo
// duplicaria esfuerzo sin agregar cobertura real.
jest.mock('jsonwebtoken');

// mockGetSigningKey vive afuera del factory de jest.mock() a proposito:
// Jest permite referenciar variables de afuera dentro del factory solo si
// el nombre empieza con "mock" (por la restriccion de babel-plugin-jest-hoist).
// Controlar el comportamiento con .mockResolvedValueOnce()/.mockRejectedValueOnce()
// por test (en vez de reasignar JwksClient.mockImplementation() como en un
// intento anterior) evita que un test deje un estado roto pegado para los
// siguientes - cada configuracion "Once" se autoconsume en esa sola llamada.
const mockGetSigningKey = jest.fn();

jest.mock('jwks-rsa', () => ({
  JwksClient: jest.fn().mockImplementation(() => ({
    getSigningKey: mockGetSigningKey,
  })),
}));

describe('WsAuthService', () => {
  let service: WsAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSigningKey.mockResolvedValue({
      getPublicKey: () => 'fake-public-key',
    });
    service = new WsAuthService();
  });

  describe('verify', () => {
    it('WsAuthService.verify rechaza cuando no se provee ningun token', async () => {
      await expect(service.verify(undefined)).rejects.toThrow(WsAuthError);
      await expect(service.verify(undefined)).rejects.toThrow(
        'Token no provisto en el handshake',
      );
    });

    it('WsAuthService.verify rechaza un token sin kid en el header', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ header: {} });

      await expect(service.verify('token-sin-kid')).rejects.toThrow(
        'Token malformado',
      );
    });

    it('WsAuthService.verify rechaza si no se puede resolver la clave de firma (JWKS)', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ header: { kid: 'kid-1' } });
      mockGetSigningKey.mockRejectedValueOnce(new Error('JWKS caido'));

      await expect(service.verify('token-cualquiera')).rejects.toThrow(
        'No se pudo resolver la clave de firma',
      );
    });

    it('WsAuthService.verify rechaza un token con firma invalida o expirado', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ header: { kid: 'kid-1' } });
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.verify('token-expirado')).rejects.toThrow(
        'Token inválido o expirado',
      );
    });

    it('WsAuthService.verify rechaza un token sin tenant_id (RD.07 - denegacion por defecto)', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ header: { kid: 'kid-1' } });
      (jwt.verify as jest.Mock).mockReturnValue({
        sub: 'usuario-1',
        realm_access: { roles: ['MOZO'] },
        // sin tenant_id
      });

      await expect(service.verify('token-sin-tenant')).rejects.toThrow(
        'tenant_id',
      );
    });

    it('WsAuthService.verify devuelve sub/tenantId/roles de un token valido', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ header: { kid: 'kid-1' } });
      (jwt.verify as jest.Mock).mockReturnValue({
        sub: 'usuario-1',
        tenant_id: 'tenant-abc',
        realm_access: { roles: ['MOZO', 'offline_access'] },
      });

      const resultado = await service.verify('token-valido');

      expect(resultado).toEqual({
        sub: 'usuario-1',
        tenantId: 'tenant-abc',
        roles: ['MOZO', 'offline_access'],
      });
    });

    it('WsAuthService.verify devuelve roles vacio si el token no trae realm_access', async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ header: { kid: 'kid-1' } });
      (jwt.verify as jest.Mock).mockReturnValue({
        sub: 'usuario-1',
        tenant_id: 'tenant-abc',
        // sin realm_access
      });

      const resultado = await service.verify('token-sin-roles');

      expect(resultado.roles).toEqual([]);
    });
  });
});
