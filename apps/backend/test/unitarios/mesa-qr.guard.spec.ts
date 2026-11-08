import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import {
  HEADER_MESA_SESION,
  HEADER_MESA_TOKEN,
  MesaDelQrActual,
  MesaQrGuard,
  MesaQrObligatoriaGuard,
  RequestConMesaQr,
} from '../../src/qr-mesa/mesa-qr.guard';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';

const SESION_ID = '99999999-9999-4999-8999-999999999999';

const MESA_DEL_QR = {
  tenantId: TENANT_ID,
  mesaId: '33333333-3333-3333-3333-333333333333',
  restauranteId: '22222222-2222-2222-2222-222222222222',
  numero: 1,
  sesionId: SESION_ID,
};

function contextoCon(request: RequestConMesaQr): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function requestCon(
  headers: RequestConMesaQr['headers'],
  tenantId: string | null = TENANT_ID,
): RequestConMesaQr {
  return {
    headers,
    user: tenantId
      ? { sub: 'comensal', tenantId, roles: ['COMENSAL'] }
      : undefined,
  };
}

describe('MesaQrGuard (BL-204)', () => {
  let mockQrMesaAcceso: { resolver: jest.Mock };
  let guard: MesaQrGuard;

  beforeEach(() => {
    mockQrMesaAcceso = { resolver: jest.fn() };
    guard = new MesaQrGuard(mockQrMesaAcceso as any);
  });

  it('sin X-Mesa-Token deja pasar sin resolver nada (pedido para retirar, canal WEB)', async () => {
    const request = requestCon({});

    await expect(guard.canActivate(contextoCon(request))).resolves.toBe(true);
    expect(mockQrMesaAcceso.resolver).not.toHaveBeenCalled();
    expect(request.mesaQr).toBeUndefined();
  });

  it('con un QR válido del mismo tenant: deja la mesa en request.mesaQr', async () => {
    mockQrMesaAcceso.resolver.mockResolvedValue(MESA_DEL_QR);
    const request = requestCon({
      [HEADER_MESA_TOKEN]: 'token-del-qr',
      [HEADER_MESA_SESION]: SESION_ID,
    });

    await expect(guard.canActivate(contextoCon(request))).resolves.toBe(true);
    expect(mockQrMesaAcceso.resolver).toHaveBeenCalledWith('token-del-qr');
    expect(request.mesaQr).toEqual(MESA_DEL_QR);
  });

  it('403 si el QR es de otro tenant que el JWT del comensal', async () => {
    mockQrMesaAcceso.resolver.mockResolvedValue({
      ...MESA_DEL_QR,
      tenantId: TENANT_ID_AJENO,
    });
    const request = requestCon({
      [HEADER_MESA_TOKEN]: 'token-del-qr',
      [HEADER_MESA_SESION]: SESION_ID,
    });

    await expect(guard.canActivate(contextoCon(request))).rejects.toThrow(
      ForbiddenException,
    );
    expect(request.mesaQr).toBeUndefined();
  });

  it('403 si no hay usuario autenticado en la request', async () => {
    mockQrMesaAcceso.resolver.mockResolvedValue(MESA_DEL_QR);
    const request = requestCon({ [HEADER_MESA_TOKEN]: 'token-del-qr' }, null);

    await expect(guard.canActivate(contextoCon(request))).rejects.toThrow(
      ForbiddenException,
    );
  });

  describe('HU-017 (BL-60): sesión de la mesa', () => {
    it('410 MESA_CERRADA si la mesa no tiene la sesión abierta', async () => {
      mockQrMesaAcceso.resolver.mockResolvedValue({
        ...MESA_DEL_QR,
        sesionId: null,
      });
      const request = requestCon({
        [HEADER_MESA_TOKEN]: 'token-del-qr',
        [HEADER_MESA_SESION]: SESION_ID,
      });

      const error = await guard
        .canActivate(contextoCon(request))
        .catch((e: GoneException) => e);
      expect(error).toBeInstanceOf(GoneException);
      expect((error as GoneException).getResponse()).toMatchObject({
        codigo: 'MESA_CERRADA',
      });
      expect(request.mesaQr).toBeUndefined();
    });

    it.each([
      ['sin header', undefined],
      ['de otra sesión (página vieja)', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      ['repetido', [SESION_ID, SESION_ID]],
    ])('410 SESION_VENCIDA con la sesión %s', async (_caso, sesion) => {
      mockQrMesaAcceso.resolver.mockResolvedValue(MESA_DEL_QR);
      const headers: RequestConMesaQr['headers'] = {
        [HEADER_MESA_TOKEN]: 'token-del-qr',
      };
      if (sesion !== undefined) headers[HEADER_MESA_SESION] = sesion;
      const request = requestCon(headers);

      const error = await guard
        .canActivate(contextoCon(request))
        .catch((e: GoneException) => e);
      expect(error).toBeInstanceOf(GoneException);
      expect((error as GoneException).getResponse()).toMatchObject({
        codigo: 'SESION_VENCIDA',
      });
      expect(request.mesaQr).toBeUndefined();
    });
  });

  it.each([
    ['inválido (404)', new NotFoundException('QR no válido')],
    ['reemplazado (410)', new GoneException('Este QR fue reemplazado.')],
  ])('propaga el error si el QR es %s', async (_caso, error) => {
    mockQrMesaAcceso.resolver.mockRejectedValue(error);
    const request = requestCon({
      [HEADER_MESA_TOKEN]: 'token-del-qr',
      [HEADER_MESA_SESION]: SESION_ID,
    });

    await expect(guard.canActivate(contextoCon(request))).rejects.toBe(error);
    expect(request.mesaQr).toBeUndefined();
  });

  it.each([
    ['vacío', ''],
    ['repetido', ['token-1', 'token-2']],
  ])(
    '400 si el header viene %s, sin intentar resolverlo',
    async (_caso, valor) => {
      const request = requestCon({ [HEADER_MESA_TOKEN]: valor });

      await expect(guard.canActivate(contextoCon(request))).rejects.toThrow(
        BadRequestException,
      );
      expect(mockQrMesaAcceso.resolver).not.toHaveBeenCalled();
    },
  );
});

describe('MesaQrObligatoriaGuard (BL-204)', () => {
  const guard = new MesaQrObligatoriaGuard();

  it('deja pasar si MesaQrGuard ya resolvió la mesa del QR', () => {
    const request = { ...requestCon({}), mesaQr: MESA_DEL_QR };

    expect(guard.canActivate(contextoCon(request))).toBe(true);
  });

  it('400 si no vino X-Mesa-Token (no hay mesa del QR)', () => {
    const request = requestCon({});

    expect(() => guard.canActivate(contextoCon(request))).toThrow(
      BadRequestException,
    );
  });
});

/**
 * Nest no expone la función interna de un createParamDecorator: se aplica
 * el decorador a un método de prueba y se lee la factory de la metadata,
 * que es lo que hace Nest al resolver los parámetros del controller.
 */
function factoryDe(decorador: () => ParameterDecorator) {
  class Prueba {
    metodo(@decorador() mesa: unknown) {
      return mesa;
    }
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Prueba, 'metodo');
  const clave = Object.keys(metadata)[0];
  return metadata[clave].factory as (
    data: unknown,
    context: ExecutionContext,
  ) => unknown;
}

describe('MesaDelQrActual (BL-204)', () => {
  const factory = factoryDe(MesaDelQrActual);

  it('devuelve la mesa que dejó MesaQrGuard en el request', () => {
    const request = { ...requestCon({}), mesaQr: MESA_DEL_QR };

    expect(factory(undefined, contextoCon(request))).toEqual(MESA_DEL_QR);
  });

  it('devuelve undefined si no vino X-Mesa-Token', () => {
    expect(factory(undefined, contextoCon(requestCon({})))).toBeUndefined();
  });
});
