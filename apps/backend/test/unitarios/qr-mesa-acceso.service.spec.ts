import { GoneException, NotFoundException } from '@nestjs/common';
import {
  exigirSesionAbierta,
  MENSAJE_MESA_CERRADA,
  MENSAJE_QR_INVALIDO,
  MENSAJE_SESION_VENCIDA,
  MENSAJE_QR_REEMPLAZADO,
  QrMesaAccesoService,
} from '../../src/qr-mesa/qr-mesa-acceso.service';
import { QrMesaTokenService } from '../../src/qr-mesa/qr-mesa-token.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';

const MESA_VIGENTE = {
  id: MESA_ID,
  tenantId: TENANT_ID,
  restauranteId: RESTAURANTE_ID,
  numero: 4,
  esVirtual: false,
  qrVersion: 2,
  sesionId: '99999999-9999-4999-8999-999999999999',
};

describe('QrMesaAccesoService (BL-204)', () => {
  const qrTokenKeyOriginal = process.env.QR_TOKEN_KEY;

  let tx: any;
  let mockTenantPrisma: any;
  let qrToken: QrMesaTokenService;
  let service: QrMesaAccesoService;

  beforeEach(() => {
    process.env.QR_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
    tx = { mesa: { findUnique: jest.fn() } };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    qrToken = new QrMesaTokenService();
    service = new QrMesaAccesoService(mockTenantPrisma, qrToken);
  });

  afterEach(() => {
    if (qrTokenKeyOriginal === undefined) delete process.env.QR_TOKEN_KEY;
    else process.env.QR_TOKEN_KEY = qrTokenKeyOriginal;
  });

  function tokenVersion(version: number): string {
    return qrToken.cifrar({ tenantId: TENANT_ID, mesaId: MESA_ID, version });
  }

  it('con un QR vigente, devuelve la mesa, su restaurante, su número y su sesión', async () => {
    tx.mesa.findUnique.mockResolvedValue(MESA_VIGENTE);

    await expect(service.resolver(tokenVersion(2))).resolves.toEqual({
      tenantId: TENANT_ID,
      mesaId: MESA_ID,
      restauranteId: RESTAURANTE_ID,
      numero: 4,
      sesionId: '99999999-9999-4999-8999-999999999999',
    });
  });

  it('HU-017 (BL-60): con la mesa cerrada, el QR sigue siendo válido (sesionId null)', async () => {
    tx.mesa.findUnique.mockResolvedValue({ ...MESA_VIGENTE, sesionId: null });

    await expect(service.resolver(tokenVersion(2))).resolves.toMatchObject({
      mesaId: MESA_ID,
      sesionId: null,
    });
  });

  it('consulta la mesa en el contexto del tenant que viene en el token', async () => {
    tx.mesa.findUnique.mockResolvedValue(MESA_VIGENTE);

    await service.resolver(tokenVersion(2));

    expect(mockTenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(tx.mesa.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MESA_ID } }),
    );
  });

  it('410 Gone si el QR es de una versión anterior (se regeneró)', async () => {
    tx.mesa.findUnique.mockResolvedValue(MESA_VIGENTE);

    const promesa = service.resolver(tokenVersion(1));

    await expect(promesa).rejects.toThrow(GoneException);
    await expect(promesa).rejects.toThrow(MENSAJE_QR_REEMPLAZADO);
  });

  it.each([
    ['la mesa ya no existe', null],
    [
      'la mesa es de otro tenant',
      { ...MESA_VIGENTE, tenantId: TENANT_ID_AJENO },
    ],
    ['es la mesa virtual', { ...MESA_VIGENTE, esVirtual: true }],
    ['la versión es mayor a la actual', { ...MESA_VIGENTE, qrVersion: 1 }],
  ])('404 genérico si %s', async (_caso, mesa) => {
    tx.mesa.findUnique.mockResolvedValue(mesa);

    const promesa = service.resolver(tokenVersion(2));

    await expect(promesa).rejects.toThrow(NotFoundException);
    await expect(promesa).rejects.toThrow(MENSAJE_QR_INVALIDO);
  });

  it('404 genérico sin consultar la base si el token no es válido', async () => {
    const promesa = service.resolver('esto-no-es-un-token');

    await expect(promesa).rejects.toThrow(NotFoundException);
    await expect(promesa).rejects.toThrow(MENSAJE_QR_INVALIDO);
    expect(mockTenantPrisma.runInTenantContext).not.toHaveBeenCalled();
  });
});

describe('exigirSesionAbierta (HU-017, BL-60)', () => {
  const SESION = '99999999-9999-4999-8999-999999999999';
  const mesa = {
    tenantId: TENANT_ID,
    mesaId: MESA_ID,
    restauranteId: RESTAURANTE_ID,
    numero: 4,
    sesionId: SESION,
  };

  function errorDe(fn: () => void): GoneException {
    try {
      fn();
    } catch (e) {
      return e as GoneException;
    }
    throw new Error('no lanzó');
  }

  it('con la sesión abierta y la de la página: deja pasar', () => {
    expect(() => exigirSesionAbierta(mesa, SESION)).not.toThrow();
  });

  it('mesa cerrada: 410 MESA_CERRADA', () => {
    const error = errorDe(() =>
      exigirSesionAbierta({ ...mesa, sesionId: null }, SESION),
    );
    expect(error).toBeInstanceOf(GoneException);
    expect(error.getResponse()).toEqual({
      statusCode: 410,
      codigo: 'MESA_CERRADA',
      message: MENSAJE_MESA_CERRADA,
    });
  });

  it.each([
    ['sin sesión', undefined],
    ['de otra apertura', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
  ])('sesión %s: 410 SESION_VENCIDA', (_caso, sesion) => {
    const error = errorDe(() => exigirSesionAbierta(mesa, sesion));
    expect(error).toBeInstanceOf(GoneException);
    expect(error.getResponse()).toEqual({
      statusCode: 410,
      codigo: 'SESION_VENCIDA',
      message: MENSAJE_SESION_VENCIDA,
    });
  });
});
