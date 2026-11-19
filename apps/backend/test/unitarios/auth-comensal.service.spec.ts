import {
  ForbiddenException,
  GoneException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AuthComensalService } from '../../src/auth-comensal/auth-comensal.service';
import { TokenInvitado } from '../../src/auth-comensal/token-invitado';
import {
  errorEstablecimientoSuspendido,
  MENSAJE_SUSPENDIDO_COMENSAL,
} from '../../src/tenant-estado/tenant-estado.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const CLAVE = 'clave-de-prueba-del-token-de-invitado-0001';

// HU-052 (BL-581): el token del comensal lo firma siempre la API (token de
// invitado). Estos tests cubren las validaciones de cada canal: si alguna
// falla, no se emite nada. El contenido del token se prueba en
// auth-comensal-invitado.spec.ts. Ningún caso va a Keycloak.
describe('AuthComensalService.emitirToken', () => {
  let mockTenantPrisma: any;
  let mockQrMesaAcceso: any;
  let mockTenantEstado: { asegurarActivo: jest.Mock };
  let mockLinkPago: { resolver: jest.Mock };
  let service: AuthComensalService;
  const envOriginal = process.env;
  let fetchMock: jest.Mock;
  let emitir: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      ...envOriginal,
      COMENSAL_TOKEN_CLAVE: CLAVE,
      COMENSAL_TOKEN_CLAVE_ANTERIOR: undefined,
    };
    emitir = jest.spyOn(TokenInvitado.prototype, 'emitir');

    mockTenantPrisma = { runInTenantContext: jest.fn() };
    mockQrMesaAcceso = { resolver: jest.fn() };
    // BL-413: establecimiento activo salvo en los tests de suspensión.
    mockTenantEstado = {
      asegurarActivo: jest.fn().mockResolvedValue(undefined),
    };
    mockLinkPago = { resolver: jest.fn() };
    service = new AuthComensalService(
      mockTenantPrisma,
      mockQrMesaAcceso,
      mockTenantEstado as any,
      mockLinkPago as any,
    );

    // Si algo intentara ir a Keycloak, el test lo vería.
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
    expect(emitir).not.toHaveBeenCalled();
  });

  it('emite el token de invitado del retiro cuando el restaurante existe, sin ir a Keycloak', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: RESTAURANTE_ID,
    });

    const resultado = await service.emitirToken(TENANT_ID, RESTAURANTE_ID);

    expect(Object.keys(resultado).sort()).toEqual(['accessToken', 'expiresIn']);
    expect(emitir).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_ID },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busca el restaurante dentro del contexto del tenant (RLS)', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: RESTAURANTE_ID });
    mockTenantPrisma.runInTenantContext.mockImplementation(
      (_tenantId: string, fn: (tx: any) => unknown) =>
        fn({ restaurante: { findUnique } }),
    );

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

  it('sin COMENSAL_TOKEN_CLAVE responde 500 y no emite nada', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env.COMENSAL_TOKEN_CLAVE;
    const sinClave = new AuthComensalService(
      mockTenantPrisma,
      mockQrMesaAcceso,
      mockTenantEstado as any,
      mockLinkPago as any,
    );
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: RESTAURANTE_ID,
    });

    await expect(
      sinClave.emitirToken(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow(InternalServerErrorException);
    expect(emitir).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[TC-U-123] no emite el token si el establecimiento está suspendido (403)', async () => {
    mockTenantPrisma.runInTenantContext.mockResolvedValue({
      id: RESTAURANTE_ID,
    });
    mockTenantEstado.asegurarActivo.mockRejectedValue(
      errorEstablecimientoSuspendido(MENSAJE_SUSPENDIDO_COMENSAL),
    );

    await expect(
      service.emitirToken(TENANT_ID, RESTAURANTE_ID),
    ).rejects.toThrow(ForbiddenException);
    expect(mockTenantEstado.asegurarActivo).toHaveBeenCalledWith(
      TENANT_ID,
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
    expect(emitir).not.toHaveBeenCalled();
  });

  // HU-034 (BL-204): token del comensal a partir del QR de la mesa.
  describe('emitirTokenPorLink (HU-033, BL-203)', () => {
    const LINK = {
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      pedidoId: '55555555-5555-4555-8555-555555555555',
    };

    it('emite el token de invitado del link con el tenant y el pedido que salen del link', async () => {
      mockLinkPago.resolver.mockResolvedValue(LINK);

      await service.emitirTokenPorLink('token-del-link');

      expect(mockLinkPago.resolver).toHaveBeenCalledWith('token-del-link');
      expect(emitir).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        restauranteId: RESTAURANTE_ID,
        canal: { tipo: 'link', pedidoId: LINK.pedidoId },
      });
    });

    it('si el link no sirve (404 / 410), no pide el token', async () => {
      mockLinkPago.resolver.mockRejectedValue(
        new Error('Link de pago no válido'),
      );

      await expect(service.emitirTokenPorLink('otro')).rejects.toThrow(
        'Link de pago no válido',
      );
      expect(emitir).not.toHaveBeenCalled();
    });

    it('con el establecimiento suspendido responde 403 sin pedir el token', async () => {
      mockLinkPago.resolver.mockResolvedValue(LINK);
      mockTenantEstado.asegurarActivo.mockRejectedValue(
        errorEstablecimientoSuspendido(MENSAJE_SUSPENDIDO_COMENSAL),
      );

      await expect(service.emitirTokenPorLink('token')).rejects.toThrow(
        MENSAJE_SUSPENDIDO_COMENSAL,
      );
      expect(emitir).not.toHaveBeenCalled();
    });
  });

  describe('emitirTokenPorQr', () => {
    it('[TC-U-124] con un QR válido de un establecimiento suspendido responde 403 sin pedir el token', async () => {
      mockQrMesaAcceso.resolver.mockResolvedValue({
        tenantId: TENANT_ID,
        mesaId: MESA_ID,
        restauranteId: RESTAURANTE_ID,
        numero: 4,
      });
      mockTenantEstado.asegurarActivo.mockRejectedValue(
        errorEstablecimientoSuspendido(MENSAJE_SUSPENDIDO_COMENSAL),
      );

      await expect(service.emitirTokenPorQr('qr-valido')).rejects.toThrow(
        MENSAJE_SUSPENDIDO_COMENSAL,
      );
      expect(emitir).not.toHaveBeenCalled();
    });

    const SESION = '99999999-9999-4999-8999-999999999999';
    const MESA_ABIERTA = {
      tenantId: TENANT_ID,
      mesaId: MESA_ID,
      restauranteId: RESTAURANTE_ID,
      numero: 4,
      sesionId: SESION,
    };

    it('emite el token de invitado de la mesa con el tenant, la mesa y la sesión que vienen del QR', async () => {
      mockQrMesaAcceso.resolver.mockResolvedValue(MESA_ABIERTA);

      await service.emitirTokenPorQr('token-del-qr', SESION);

      expect(mockQrMesaAcceso.resolver).toHaveBeenCalledWith('token-del-qr');
      expect(emitir).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        restauranteId: RESTAURANTE_ID,
        canal: { tipo: 'mesa', mesaId: MESA_ID, sesionId: SESION },
      });
    });

    it.each([
      [
        'la mesa está cerrada',
        { ...MESA_ABIERTA, sesionId: null },
        SESION,
        'MESA_CERRADA',
      ],
      [
        'la sesión es de otra apertura',
        MESA_ABIERTA,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'SESION_VENCIDA',
      ],
      ['no vino la sesión', MESA_ABIERTA, undefined, 'SESION_VENCIDA'],
    ])(
      'HU-017 (BL-60): 410 sin pedir token si %s',
      async (_caso, mesa, sesion, codigo) => {
        mockQrMesaAcceso.resolver.mockResolvedValue(mesa);

        const error = await service
          .emitirTokenPorQr('token-del-qr', sesion)
          .catch((e: GoneException) => e);
        expect(error).toBeInstanceOf(GoneException);
        expect((error as GoneException).getResponse()).toMatchObject({
          codigo,
        });
        expect(emitir).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['inválido (404)', new NotFoundException('QR no válido')],
      ['reemplazado (410)', new GoneException('Este QR fue reemplazado.')],
    ])('no emite el token si el QR es %s', async (_caso, error) => {
      mockQrMesaAcceso.resolver.mockRejectedValue(error);

      await expect(service.emitirTokenPorQr('token-del-qr')).rejects.toBe(
        error,
      );
      expect(emitir).not.toHaveBeenCalled();
    });
  });
});
