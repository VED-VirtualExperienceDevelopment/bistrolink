import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AuthComensalService } from '../../src/auth-comensal/auth-comensal.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';

describe('AuthComensalService.emitirToken', () => {
  let mockTenantPrisma: any;
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
    service = new AuthComensalService(mockTenantPrisma);

    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    process.env = envOriginal;
    jest.restoreAllMocks();
  });

  it('rechaza si no se manda ni mesaId ni restauranteId', async () => {
    await expect(service.emitirToken(TENANT_ID)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockTenantPrisma.runInTenantContext).not.toHaveBeenCalled();
  });

  it('rechaza con 404 si la mesa no existe', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue(null);

    await expect(service.emitirToken(TENANT_ID, MESA_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechaza con 404 si el restaurante no existe (flujo sin mesa)', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue(null);

    await expect(
      service.emitirToken(TENANT_ID, undefined, RESTAURANTE_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('emite el token con el username derivado del tenant, cuando la mesa existe', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue({ id: MESA_ID });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'jwt-de-prueba', expires_in: 3600 }),
    });

    const resultado = await service.emitirToken(TENANT_ID, MESA_ID);

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

  it('emite el token también en el flujo sin mesa (restauranteId solo)', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: RESTAURANTE_ID,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'jwt-de-prueba', expires_in: 3600 }),
    });

    const resultado = await service.emitirToken(
      TENANT_ID,
      undefined,
      RESTAURANTE_ID,
    );

    expect(resultado.accessToken).toBe('jwt-de-prueba');
  });

  it('lanza un error de servidor si Keycloak responde con error', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue({ id: MESA_ID });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(service.emitirToken(TENANT_ID, MESA_ID)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('lanza un error si falta KEYCLOAK_CLIENT_SECRET en el entorno', async () => {
    delete process.env.KEYCLOAK_CLIENT_SECRET;
    mockTenantPrisma.runInTenantContext.mockResolvedValue({ id: MESA_ID });

    await expect(service.emitirToken(TENANT_ID, MESA_ID)).rejects.toThrow(
      'Falta KEYCLOAK_CLIENT_SECRET en el .env',
    );
  });

  it('lanza un error si falta KEYCLOAK_COMENSAL_PASSWORD en el entorno', async () => {
    delete process.env.KEYCLOAK_COMENSAL_PASSWORD;
    mockTenantPrisma.runInTenantContext.mockResolvedValue({ id: MESA_ID });

    await expect(service.emitirToken(TENANT_ID, MESA_ID)).rejects.toThrow(
      'Falta KEYCLOAK_COMENSAL_PASSWORD en el .env',
    );
  });
});
