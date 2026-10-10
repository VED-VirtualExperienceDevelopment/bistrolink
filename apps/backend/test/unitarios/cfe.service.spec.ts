import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CfeService } from '../../src/cfe/cfe.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PAGO_ID = '22222222-2222-2222-2222-222222222222';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';

function pagoBd(overrides: Record<string, unknown> = {}) {
  return {
    id: PAGO_ID,
    pedidoId: PEDIDO_ID,
    estado: 'APROBADO',
    comprobantes: [],
    pedido: {
      lineas: [
        {
          nombreSnapshot: 'Milanesa a la napolitana',
          cantidad: 2,
          precioUnitarioSnapshot: new Prisma.Decimal('295.00'),
        },
      ],
    },
    ...overrides,
  };
}

const EMITIDO = {
  id: '541759',
  serie: 'A',
  numero: 49,
  hash: 'YuFjLi8FhjlpqbniSfBS0OfmpPFErwiODpihtMqCyYs=',
  caeNumero: '90191275538',
  caeVencimiento: new Date('2030-12-31T00:00:00'),
  url: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
};

describe('CfeService.intentarEmitir', () => {
  let tx: {
    pago: { findUnique: jest.Mock };
    tenant: { findUnique: jest.Mock };
    comprobanteFiscal: { upsert: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let surtec: { configurado: jest.Mock; emitirETicket: jest.Mock };
  let service: CfeService;

  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
    tx = {
      pago: { findUnique: jest.fn().mockResolvedValue(pagoBd()) },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ rut: '214198620015' }),
      },
      comprobanteFiscal: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }) => Promise.resolve(create)),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    surtec = {
      configurado: jest.fn().mockReturnValue(true),
      emitirETicket: jest.fn().mockResolvedValue(EMITIDO),
    };
    service = new CfeService(tenantPrisma as any, surtec as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('emite el eTicket con el RUT del tenant, el id del pago como id_externo y las líneas del pedido', async () => {
    await service.intentarEmitir(TENANT_ID, PAGO_ID);

    expect(surtec.emitirETicket).toHaveBeenCalledWith({
      rutEmisor: '214198620015',
      idExterno: `bl-${PAGO_ID}`,
      items: [
        { concepto: 'Milanesa a la napolitana', cantidad: 2, precio: 295 },
      ],
      adenda: 'Pedido 3cdf1dad',
    });
  });

  it('guarda serie, número, hash, CAE y URL de DGI, y retiene 5 años', async () => {
    const resumen = await service.intentarEmitir(TENANT_ID, PAGO_ID);

    const { create, where } = tx.comprobanteFiscal.upsert.mock.calls[0][0];
    expect(where).toEqual({ idExterno: `bl-${PAGO_ID}` });
    expect(create).toMatchObject({
      tenantId: TENANT_ID,
      pedidoId: PEDIDO_ID,
      pagoId: PAGO_ID,
      tipoCfe: '101',
      serie: 'A',
      numero: 49,
      hashSha256: EMITIDO.hash,
      proveedor: 'SURTEC',
      proveedorRef: '541759',
      caeNumero: '90191275538',
      urlConsulta: EMITIDO.url,
    });
    expect(
      create.retencionHasta.getFullYear() - create.fechaEmision.getFullYear(),
    ).toBe(5);
    expect(resumen).toEqual({
      serie: 'A',
      numero: 49,
      urlConsulta: EMITIDO.url,
    });
  });

  it('campos opcionales que Surtec no devuelve se guardan como null', async () => {
    surtec.emitirETicket.mockResolvedValue({
      id: '1',
      serie: 'A',
      numero: 1,
    });

    await service.intentarEmitir(TENANT_ID, PAGO_ID);

    expect(tx.comprobanteFiscal.upsert.mock.calls[0][0].create).toMatchObject({
      hashSha256: null,
      caeNumero: null,
      caeVencimiento: null,
      urlConsulta: null,
    });
  });

  it('si el pago ya tiene comprobante, lo devuelve y NO vuelve a emitir', async () => {
    tx.pago.findUnique.mockResolvedValue(
      pagoBd({
        comprobantes: [{ serie: 'A', numero: 7, urlConsulta: 'https://x' }],
      }),
    );

    const resumen = await service.intentarEmitir(TENANT_ID, PAGO_ID);

    expect(surtec.emitirETicket).not.toHaveBeenCalled();
    expect(resumen).toEqual({
      serie: 'A',
      numero: 7,
      urlConsulta: 'https://x',
    });
  });

  it.each(['PENDIENTE', 'RECHAZADO', 'REEMBOLSADO'])(
    'pago %s => no emite',
    async (estado) => {
      tx.pago.findUnique.mockResolvedValue(pagoBd({ estado }));

      expect(await service.intentarEmitir(TENANT_ID, PAGO_ID)).toBeNull();
      expect(surtec.emitirETicket).not.toHaveBeenCalled();
    },
  );

  it('pago inexistente => no emite', async () => {
    tx.pago.findUnique.mockResolvedValue(null);

    expect(await service.intentarEmitir(TENANT_ID, PAGO_ID)).toBeNull();
    expect(surtec.emitirETicket).not.toHaveBeenCalled();
  });

  it('tenant inexistente => no emite', async () => {
    tx.tenant.findUnique.mockResolvedValue(null);

    expect(await service.intentarEmitir(TENANT_ID, PAGO_ID)).toBeNull();
    expect(surtec.emitirETicket).not.toHaveBeenCalled();
  });

  it('Surtec sin configurar => avisa y no emite', async () => {
    surtec.configurado.mockReturnValue(false);

    expect(await service.intentarEmitir(TENANT_ID, PAGO_ID)).toBeNull();
    expect(surtec.emitirETicket).not.toHaveBeenCalled();
    expect(Logger.warn).toHaveBeenCalled();
  });

  it('si Surtec falla, NO lanza: devuelve null y lo registra (el cobro ya se hizo)', async () => {
    surtec.emitirETicket.mockRejectedValue(new Error('HTTP 503'));

    await expect(
      service.intentarEmitir(TENANT_ID, PAGO_ID),
    ).resolves.toBeNull();
    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('HTTP 503'),
      undefined,
      'CfeService',
    );
    expect(tx.comprobanteFiscal.upsert).not.toHaveBeenCalled();
  });

  it('un error que no es Error también se registra sin romper', async () => {
    surtec.emitirETicket.mockRejectedValue('boom');

    await expect(
      service.intentarEmitir(TENANT_ID, PAGO_ID),
    ).resolves.toBeNull();
  });
});
