import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  esDeLaSesion,
  MARGEN_RELOJ_SESION_MS,
  MENSAJE_PEDIDO_DE_OTRA_SESION,
  PedidoAccesoGuard,
} from '../../src/pedidos/pedido-acceso.guard';
import {
  generarTokenAcceso,
  HEADER_PEDIDO_TOKEN,
} from '../../src/pedidos/token-acceso-pedido';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const OTRA_MESA_ID = '44444444-4444-4444-4444-444444444444';

const mesaQr = (mesaId: string) => ({
  tenantId: TENANT_ID,
  mesaId,
  restauranteId: '22222222-2222-2222-2222-222222222222',
  numero: 3,
});

function contexto(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    params: { pedidoId: PEDIDO_ID },
    headers: {},
    user: { sub: 'comensal', tenantId: TENANT_ID, roles: ['COMENSAL'] },
    ...overrides,
  };
}

describe('PedidoAccesoGuard (BL-311, RD.05: solo quien hizo el pedido lo paga y ve el CFE)', () => {
  let findUnique: jest.Mock;
  let runInTenantContext: jest.Mock;
  let guard: PedidoAccesoGuard;

  beforeEach(() => {
    findUnique = jest.fn();
    runInTenantContext = jest.fn((_tenantId, fn) =>
      fn({ pedido: { findUnique } }),
    );
    guard = new PedidoAccesoGuard({ runInTenantContext } as any);
  });

  describe('pedido de mesa (canal QR)', () => {
    beforeEach(() => {
      findUnique.mockResolvedValue({
        mesaId: MESA_ID,
        canal: 'QR',
        accesoTokenHash: null,
      });
    });

    it('con el QR de la misma mesa: deja pasar', async () => {
      await expect(
        guard.canActivate(contexto(request({ mesaQr: mesaQr(MESA_ID) }))),
      ).resolves.toBe(true);
    });

    it('con el QR de OTRA mesa del mismo local: 403', async () => {
      await expect(
        guard.canActivate(contexto(request({ mesaQr: mesaQr(OTRA_MESA_ID) }))),
      ).rejects.toThrow(ForbiddenException);
    });

    // BL-502 (RD.05): solo los pedidos de la sesión abierta de la mesa.
    describe('BL-502: sesión de la mesa', () => {
      const ABIERTA = new Date('2026-11-10T22:00:00.000Z');
      const conSesion = { ...mesaQr(MESA_ID), sesionAbiertaEn: ABIERTA };

      it('un pedido de esta sesión: deja pasar', async () => {
        findUnique.mockResolvedValue({
          mesaId: MESA_ID,
          canal: 'QR',
          accesoTokenHash: null,
          createdAt: new Date('2026-11-10T22:15:00.000Z'),
        });
        await expect(
          guard.canActivate(contexto(request({ mesaQr: conSesion }))),
        ).resolves.toBe(true);
      });

      it('un pedido de una sesión anterior de la misma mesa: 403', async () => {
        findUnique.mockResolvedValue({
          mesaId: MESA_ID,
          canal: 'QR',
          accesoTokenHash: null,
          createdAt: new Date('2026-11-10T21:57:59.999Z'),
        });
        await expect(
          guard.canActivate(contexto(request({ mesaQr: conSesion }))),
        ).rejects.toThrow(
          new ForbiddenException(MENSAJE_PEDIDO_DE_OTRA_SESION),
        );
      });

      it('esDeLaSesion: desde la apertura, con 2 minutos de margen por los relojes; sin fecha de apertura, sí', () => {
        expect(esDeLaSesion(ABIERTA, ABIERTA)).toBe(true);
        const margen = ABIERTA.getTime() - MARGEN_RELOJ_SESION_MS;
        expect(esDeLaSesion(new Date(margen), ABIERTA)).toBe(true);
        expect(esDeLaSesion(new Date(margen - 1), ABIERTA)).toBe(false);
        expect(esDeLaSesion(new Date(0), null)).toBe(true);
        expect(esDeLaSesion(new Date(0), undefined)).toBe(true);
      });
    });

    it('sin X-Mesa-Token: 400 (no es una sesión vencida)', async () => {
      await expect(guard.canActivate(contexto(request()))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('un token de pedido para retirar no sirve para un pedido de mesa', async () => {
      const { token } = generarTokenAcceso();
      await expect(
        guard.canActivate(
          contexto(request({ headers: { [HEADER_PEDIDO_TOKEN]: token } })),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('pedido para retirar (canal WEB)', () => {
    const acceso = generarTokenAcceso();

    beforeEach(() => {
      findUnique.mockResolvedValue({
        mesaId: 'mesa-virtual',
        canal: 'WEB',
        accesoTokenHash: acceso.hash,
      });
    });

    it('con el token que se devolvió al crearlo: deja pasar', async () => {
      await expect(
        guard.canActivate(
          contexto(
            request({ headers: { [HEADER_PEDIDO_TOKEN]: acceso.token } }),
          ),
        ),
      ).resolves.toBe(true);
    });

    it('con otro token: 403', async () => {
      await expect(
        guard.canActivate(
          contexto(
            request({
              headers: { [HEADER_PEDIDO_TOKEN]: generarTokenAcceso().token },
            }),
          ),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('sin X-Pedido-Token: 400', async () => {
      await expect(guard.canActivate(contexto(request()))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('header repetido (array): 400, no se intenta adivinar cuál usar', async () => {
      await expect(
        guard.canActivate(
          contexto(
            request({
              headers: { [HEADER_PEDIDO_TOKEN]: [acceso.token, 'otro'] },
            }),
          ),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('el QR de una mesa no reemplaza al token del pedido para retirar', async () => {
      await expect(
        guard.canActivate(contexto(request({ mesaQr: mesaQr(MESA_ID) }))),
      ).rejects.toThrow(BadRequestException);
    });

    it('pedido para retirar viejo, sin hash guardado: 403', async () => {
      findUnique.mockResolvedValue({
        mesaId: 'mesa-virtual',
        canal: 'WEB',
        accesoTokenHash: null,
      });
      await expect(
        guard.canActivate(
          contexto(
            request({ headers: { [HEADER_PEDIDO_TOKEN]: acceso.token } }),
          ),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('busca el pedido dentro del tenant del JWT (RLS)', async () => {
    findUnique.mockResolvedValue({
      mesaId: MESA_ID,
      canal: 'QR',
      accesoTokenHash: null,
    });

    await guard.canActivate(contexto(request({ mesaQr: mesaQr(MESA_ID) })));

    expect(runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: PEDIDO_ID },
      select: {
        mesaId: true,
        canal: true,
        accesoTokenHash: true,
        createdAt: true,
        estado: true,
        linkPagoHash: true,
        linkPagoVenceEn: true,
      },
    });
  });

  it('pedido de otro tenant o inexistente: 404', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(contexto(request({ mesaQr: mesaQr(MESA_ID) }))),
    ).rejects.toThrow(NotFoundException);
  });

  it('pedidoId que no es UUID: 400 sin consultar la base', async () => {
    await expect(
      guard.canActivate(contexto(request({ params: { pedidoId: 'x' } }))),
    ).rejects.toThrow(BadRequestException);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
