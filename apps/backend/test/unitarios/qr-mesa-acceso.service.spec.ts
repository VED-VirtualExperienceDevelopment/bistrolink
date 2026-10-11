import { GoneException, NotFoundException } from '@nestjs/common';
import {
  MENSAJE_QR_INVALIDO,
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

  it('con un QR vigente, devuelve la mesa, su restaurante y su número', async () => {
    tx.mesa.findUnique.mockResolvedValue(MESA_VIGENTE);

    await expect(service.resolver(tokenVersion(2))).resolves.toEqual({
      tenantId: TENANT_ID,
      mesaId: MESA_ID,
      restauranteId: RESTAURANTE_ID,
      numero: 4,
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
