import {
  GoneException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AuthComensalService } from '../../src/auth-comensal/auth-comensal.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';

describe('AuthComensalService.emitirToken', () => {
  let mockTenantPrisma: any;
  let mockQrMesaAcceso: any;
  let service: AuthComensalService;
  const envOriginal = process.env;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = {
      ...envOriginal,
      KEYCLOAK_CLIENT_SECRET: 'secreto-de-prueba',
      KEYCLOAK_COMENSAL_PASSWORD: 'password-de-prueba',
      KEYCLOAK_URL: 'http://keycloak-test:8080',
      KEYCLOAK_REALM: 'bistrolink-test',
      KEYCLOAK_CLIENT_ID: 'bistrolink-backend-test',
    };

    mockTenantPrisma = { runInTenantContext: jest.fn() };
    mockQrMesaAcceso = { resolver: jest.fn() };
    service = new AuthComensalService(mockTenantPrisma, mockQrMesaAcceso);

    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    process.env = envOriginal;
    jest.restoreAllMocks();
  });

  // Pedido para retirar (link web del local). La mesa ya no se acepta acá:
  // sale solo del QR (BL-204, emitirTokenPorQr).
  it('rechaza con 404 si el restaurante no existe', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue(null);

    await expect(
      service.emitirToken(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow(NotFoundException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emite el token con el username derivado del tenant, cuando el restaurante existe', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: RESTAURANTE_ID,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'jwt-de-prueba', expires_in: 3600 }),
    });

    const resultado = await service.emitirToken(TENANT_ID, RESTAURANTE_ID);

    expect(resultado).toEqual({
      accessToken: 'jwt-de-prueba',
      expiresIn: 3600,
    });

    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://keycloak-test:8080/realms/bistrolink-test/protocol/openid-connect/token',
    );
    const body = opciones.body as URLSearchParams;
    expect(body.get('username')).toBe(`comensal-${TENANT_ID}`);
    expect(body.get('grant_type')).toBe('password');
  });

  it('busca el restaurante dentro del contexto del tenant (RLS)', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: RESTAURANTE_ID });
    mockTenantPrisma.runInTenantContext.mockImplementation(
      (_tenantId: string, fn: (tx: any) => unknown) =>
        fn({ restaurante: { findUnique } }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'jwt-de-prueba', expires_in: 3600 }),
    });

    await service.emitirToken(TENANT_ID, RESTAURANTE_ID);

    expect(mockTenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: RESTAURANTE_ID },
      select: { id: true },
    });
  });

  it('lanza un error de servidor si Keycloak responde con error', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: RESTAURANTE_ID,
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(
      service.emitirToken(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('lanza un error si falta KEYCLOAK_CLIENT_SECRET en el entorno', async () => {
    delete process.env.KEYCLOAK_CLIENT_SECRET;
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: RESTAURANTE_ID,
    });

    await expect(
      service.emitirToken(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow('Falta KEYCLOAK_CLIENT_SECRET en el .env');
  });

  it('lanza un error si falta KEYCLOAK_COMENSAL_PASSWORD en el entorno', async () => {
    delete process.env.KEYCLOAK_COMENSAL_PASSWORD;
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: RESTAURANTE_ID,
    });

    await expect(
      service.emitirToken(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow('Falta KEYCLOAK_COMENSAL_PASSWORD en el .env');
  });

  // HU-034 (BL-204): token del comensal a partir del QR de la mesa.
  describe('emitirTokenPorQr', () => {
    it('emite el token del comensal técnico del tenant que viene en el QR', async () => {
      mockQrMesaAcceso.resolver.mockResolvedValue({
        tenantId: TENANT_ID,
        mesaId: MESA_ID,
        restauranteId: RESTAURANTE_ID,
        numero: 4,
      });
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'jwt-de-prueba', expires_in: 3600 }),
      });

      const resultado = await service.emitirTokenPorQr('token-del-qr');

      expect(mockQrMesaAcceso.resolver).toHaveBeenCalledWith('token-del-qr');
      expect(resultado).toEqual({
        accessToken: 'jwt-de-prueba',
        expiresIn: 3600,
      });
      const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
      expect(body.get('username')).toBe(`comensal-${TENANT_ID}`);
    });

    it.each([
      ['inválido (404)', new NotFoundException('QR no válido')],
      ['reemplazado (410)', new GoneException('Este QR fue reemplazado.')],
    ])('no pide token a Keycloak si el QR es %s', async (_caso, error) => {
      mockQrMesaAcceso.resolver.mockRejectedValue(error);

      await expect(service.emitirTokenPorQr('token-del-qr')).rejects.toBe(
        error,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
