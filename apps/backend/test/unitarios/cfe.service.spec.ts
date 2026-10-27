import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CfeService,
  ESPERAS_REINTENTO_CFE_MS,
  esErrorTransitorio,
} from '../../src/cfe/cfe.service';
import { SurtecError } from '../../src/cfe/surtec.client';

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

describe('esErrorTransitorio', () => {
  it.each([
    [new SurtecError('caído', 503), true],
    [new SurtecError('demasiados pedidos', 429), true],
    [new TypeError('fetch failed'), true],
    [new DOMException('timeout', 'TimeoutError'), true],
    [new SurtecError('no es un emisor válido', 400), false],
    [new SurtecError('Surtec no aceptó las credenciales'), false],
  ])('%p => %p', (error, esperado) => {
    expect(esErrorTransitorio(error)).toBe(esperado);
  });
});

describe('CfeService.emitirConReintentos (BL-311)', () => {
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

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('Surtec responde bien: emite en el primer intento', async () => {
    const resumen = await service.emitirConReintentos(TENANT_ID, PAGO_ID);

    expect(resumen).toEqual({
      serie: 'A',
      numero: 49,
      urlConsulta: EMITIDO.url,
    });
    expect(surtec.emitirETicket).toHaveBeenCalledTimes(1);
  });

  it('falla transitoria (503): reintenta con el mismo id_externo y emite', async () => {
    jest.useFakeTimers();
    surtec.emitirETicket
      .mockRejectedValueOnce(new SurtecError('caído', 503))
      .mockResolvedValueOnce(EMITIDO);

    const emision = service.emitirConReintentos(TENANT_ID, PAGO_ID);
    await jest.advanceTimersByTimeAsync(ESPERAS_REINTENTO_CFE_MS[0]);

    await expect(emision).resolves.toMatchObject({ serie: 'A', numero: 49 });
    expect(surtec.emitirETicket).toHaveBeenCalledTimes(2);
    const ids = surtec.emitirETicket.mock.calls.map(([c]) => c.idExterno);
    expect(ids).toEqual([`bl-${PAGO_ID}`, `bl-${PAGO_ID}`]);
  });

  it('Surtec sigue caído: corta después de 3 intentos, devuelve null y lo registra', async () => {
    jest.useFakeTimers();
    surtec.emitirETicket.mockRejectedValue(new SurtecError('caído', 503));

    const emision = service.emitirConReintentos(TENANT_ID, PAGO_ID);
    for (const espera of ESPERAS_REINTENTO_CFE_MS) {
      await jest.advanceTimersByTimeAsync(espera);
    }

    await expect(emision).resolves.toBeNull();
    expect(surtec.emitirETicket).toHaveBeenCalledTimes(
      ESPERAS_REINTENTO_CFE_MS.length + 1,
    );
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });

  it('error permanente (4xx, ej. RUT no habilitado): no reintenta', async () => {
    surtec.emitirETicket.mockRejectedValue(
      new SurtecError('210000000019 no es un emisor válido.', 400),
    );

    await expect(
      service.emitirConReintentos(TENANT_ID, PAGO_ID),
    ).resolves.toBeNull();
    expect(surtec.emitirETicket).toHaveBeenCalledTimes(1);
    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('no es un emisor válido'),
      undefined,
      'CfeService',
    );
  });

  it('POST y webhook a la vez: una sola emisión para el mismo pago', async () => {
    const [a, b] = await Promise.all([
      service.emitirConReintentos(TENANT_ID, PAGO_ID),
      service.emitirConReintentos(TENANT_ID, PAGO_ID),
    ]);

    expect(a).toEqual(b);
    expect(surtec.emitirETicket).toHaveBeenCalledTimes(1);
  });

  it('emitirEnSegundoPlano no espera ni lanza aunque Surtec falle', () => {
    surtec.emitirETicket.mockRejectedValue(new SurtecError('x', 400));

    expect(service.emitirEnSegundoPlano(TENANT_ID, PAGO_ID)).toBeUndefined();
  });
});
