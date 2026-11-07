import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CfeService,
  ESPERAS_REINTENTO_CFE_MS,
  esErrorTransitorio,
  esRechazoDeLaEFactura,
  nombreArchivoPdf,
} from '../../src/cfe/cfe.service';
import { SurtecError } from '../../src/cfe/surtec.client';
import { sha256Hex } from '../../src/cfe/respaldo-pdf/almacen-cfe';

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

// BL-454: copia del PDF en S3. Por defecto no está configurada.
let almacen: { configurado: jest.Mock; leer: jest.Mock };
beforeEach(() => {
  almacen = { configurado: jest.fn().mockReturnValue(false), leer: jest.fn() };
});

describe('CfeService.intentarEmitir', () => {
  let tx: {
    pago: { findUnique: jest.Mock };
    tenant: { findUnique: jest.Mock };
    comprobanteFiscal: { upsert: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let surtec: {
    configurado: jest.Mock;
    emitirETicket: jest.Mock;
    emitirEFactura: jest.Mock;
  };
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
      emitirEFactura: jest.fn().mockResolvedValue(EMITIDO),
    };
    service = new CfeService(
      tenantPrisma as any,
      surtec as any,
      almacen as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('HU-009 (BL-453): e-Factura', () => {
    const conReceptor = () =>
      pagoBd({
        pedido: {
          ...pagoBd().pedido,
          receptorRut: '219999830019',
          receptorRazonSocial: 'Comensal Ejemplo SAS',
        },
      });

    it('el pedido tiene RUT y razón social: emite la e-Factura (111) con ese receptor y la guarda como 111', async () => {
      tx.pago.findUnique.mockResolvedValue(conReceptor());

      const resumen = await service.intentarEmitir(TENANT_ID, PAGO_ID);

      expect(surtec.emitirETicket).not.toHaveBeenCalled();
      expect(surtec.emitirEFactura).toHaveBeenCalledWith(
        expect.objectContaining({
          rutEmisor: '214198620015',
          idExterno: `bl-${PAGO_ID}`,
          adenda: 'Pedido 3cdf1dad',
        }),
        { rut: '219999830019', razonSocial: 'Comensal Ejemplo SAS' },
      );
      const { create, where } = tx.comprobanteFiscal.upsert.mock.calls[0][0];
      expect(where).toEqual({ idExterno: `bl-${PAGO_ID}` });
      expect(create).toMatchObject({ tipoCfe: '111' });
      expect(resumen).toMatchObject({ tipoCfe: '111', serie: 'A' });
    });

    it('la rebaja de IVA (HU-037) sigue en la adenda de la e-Factura', async () => {
      tx.pago.findUnique.mockResolvedValue(
        pagoBd({
          medioPago: 'MERCADOPAGO',
          pedido: { ...conReceptor().pedido, canal: 'QR' },
        }),
      );

      await service.intentarEmitir(TENANT_ID, PAGO_ID);

      expect(surtec.emitirEFactura.mock.calls[0][0].adenda).toBe(
        'Pedido 3cdf1dad. Reducción IVA Ley N° 17.934',
      );
    });

    it.each([
      ['sin RUT', { receptorRut: null, receptorRazonSocial: 'Ejemplo SAS' }],
      [
        'sin razón social',
        { receptorRut: '219999830019', receptorRazonSocial: null },
      ],
      ['anonimizado', { receptorRut: null, receptorRazonSocial: null }],
    ])('%s: emite un e-Ticket', async (_caso, receptor) => {
      tx.pago.findUnique.mockResolvedValue(
        pagoBd({ pedido: { ...pagoBd().pedido, ...receptor } }),
      );

      await service.intentarEmitir(TENANT_ID, PAGO_ID);

      expect(surtec.emitirEFactura).not.toHaveBeenCalled();
      expect(surtec.emitirETicket).toHaveBeenCalledTimes(1);
      expect(tx.comprobanteFiscal.upsert.mock.calls[0][0].create.tipoCfe).toBe(
        '101',
      );
    });

    it('Surtec rechaza la e-Factura (400): emite un e-Ticket con otra clave y sin el RUT en el log', async () => {
      tx.pago.findUnique.mockResolvedValue(conReceptor());
      surtec.emitirEFactura.mockRejectedValue(
        new SurtecError('Surtec rechazó la emisión (HTTP 400): {}', 400),
      );

      const resumen = await service.intentarEmitir(TENANT_ID, PAGO_ID);

      expect(surtec.emitirETicket).toHaveBeenCalledWith(
        expect.objectContaining({ idExterno: `bl-${PAGO_ID}-et` }),
      );
      const { create, where } = tx.comprobanteFiscal.upsert.mock.calls[0][0];
      expect(where).toEqual({ idExterno: `bl-${PAGO_ID}-et` });
      expect(create).toMatchObject({ tipoCfe: '101' });
      expect(resumen).toMatchObject({ tipoCfe: '101' });
      const logs = JSON.stringify((Logger.warn as jest.Mock).mock.calls);
      expect(logs).not.toContain('219999830019');
      expect(logs).not.toContain('Comensal Ejemplo SAS');
    });

    it('Surtec caído (503) con la e-Factura: no cambia a e-Ticket (se reintenta la e-Factura)', async () => {
      tx.pago.findUnique.mockResolvedValue(conReceptor());
      surtec.emitirEFactura.mockRejectedValue(new SurtecError('caído', 503));

      expect(await service.intentarEmitir(TENANT_ID, PAGO_ID)).toBeNull();
      expect(surtec.emitirETicket).not.toHaveBeenCalled();
    });
  });

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

  it('HU-037 (BL-207): pago con tarjeta de un consumo en el local: la adenda lleva la leyenda de la rebaja y el CFE va por el total', async () => {
    tx.pago.findUnique.mockResolvedValue(
      pagoBd({
        medioPago: 'MERCADOPAGO',
        pedido: { ...pagoBd().pedido, canal: 'QR' },
      }),
    );

    await service.intentarEmitir(TENANT_ID, PAGO_ID);

    const solicitud = surtec.emitirETicket.mock.calls[0][0];
    expect(solicitud.adenda).toBe(
      'Pedido 3cdf1dad. Reducción IVA Ley N° 17.934',
    );
    // Sin descuento: las líneas van con su precio.
    expect(solicitud.items).toEqual([
      { concepto: 'Milanesa a la napolitana', cantidad: 2, precio: 295 },
    ]);
  });

  it.each([
    ['efectivo', 'EFECTIVO', 'QR'],
    ['para retirar', 'MERCADOPAGO', 'WEB'],
  ])(
    'HU-037 (BL-207): %s: la adenda no lleva la leyenda',
    async (_caso, medioPago, canal) => {
      tx.pago.findUnique.mockResolvedValue(
        pagoBd({ medioPago, pedido: { ...pagoBd().pedido, canal } }),
      );

      await service.intentarEmitir(TENANT_ID, PAGO_ID);

      expect(surtec.emitirETicket.mock.calls[0][0].adenda).toBe(
        'Pedido 3cdf1dad',
      );
    },
  );

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
      tipoCfe: '101',
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
        comprobantes: [
          { tipoCfe: '111', serie: 'A', numero: 7, urlConsulta: 'https://x' },
        ],
      }),
    );

    const resumen = await service.intentarEmitir(TENANT_ID, PAGO_ID);

    expect(surtec.emitirETicket).not.toHaveBeenCalled();
    expect(resumen).toEqual({
      tipoCfe: '111',
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
    service = new CfeService(
      tenantPrisma as any,
      surtec as any,
      almacen as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('Surtec responde bien: emite en el primer intento', async () => {
    const resumen = await service.emitirConReintentos(TENANT_ID, PAGO_ID);

    expect(resumen).toEqual({
      tipoCfe: '101',
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

describe('esRechazoDeLaEFactura (HU-009, BL-453)', () => {
  it.each([
    [new SurtecError('rechazo', 400), true],
    [new SurtecError('rechazo', 422), true],
    [new SurtecError('demasiadas', 429), false],
    [new SurtecError('caído', 503), false],
    [new SurtecError('sin status'), false],
    [new Error('fetch failed'), false],
  ])('%s => %s', (error, esperado) => {
    expect(esRechazoDeLaEFactura(error)).toBe(esperado);
  });
});

describe('CfeService.reintentar (HU-023, BL-96)', () => {
  let tx: {
    pago: { findUnique: jest.Mock; update: jest.Mock };
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
      pago: {
        findUnique: jest.fn().mockResolvedValue(pagoBd()),
        update: jest.fn().mockResolvedValue({}),
      },
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
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    surtec = {
      configurado: jest.fn().mockReturnValue(true),
      emitirETicket: jest.fn().mockResolvedValue(EMITIDO),
    };
    service = new CfeService(
      tenantPrisma as any,
      surtec as any,
      almacen as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('emite y responde el comprobante, sin registrar intentos', async () => {
    await expect(service.reintentar(TENANT_ID, PAGO_ID)).resolves.toEqual({
      comprobante: expect.objectContaining({ serie: 'A', numero: 49 }),
      error: null,
    });
    expect(tx.pago.update).not.toHaveBeenCalled();
    expect(service.configurado()).toBe(true);
  });

  it('si falla, responde el error (un solo intento, sin esperas) y lo registra en el pago', async () => {
    surtec.emitirETicket.mockRejectedValue(
      new SurtecError('Surtec rechazó la emisión (HTTP 400): {}', 400),
    );

    const r = await service.reintentar(TENANT_ID, PAGO_ID);

    expect(r).toEqual({
      comprobante: null,
      error: 'Surtec rechazó la emisión (HTTP 400): {}',
    });
    expect(surtec.emitirETicket).toHaveBeenCalledTimes(1);
    expect(tx.pago.update).toHaveBeenCalledWith({
      where: { id: PAGO_ID },
      data: {
        cfeIntentos: { increment: 1 },
        cfeUltimoIntentoEn: expect.any(Date),
        cfeUltimoError: 'Surtec rechazó la emisión (HTTP 400): {}',
      },
    });
  });

  it('el error guardado se corta a 300 caracteres', async () => {
    surtec.emitirETicket.mockRejectedValue(new Error('x'.repeat(500)));

    await service.reintentar(TENANT_ID, PAGO_ID);

    expect(tx.pago.update.mock.calls[0][0].data.cfeUltimoError).toHaveLength(
      300,
    );
  });

  it('si no puede registrar el intento, no lanza (queda en el log)', async () => {
    surtec.emitirETicket.mockRejectedValue(new Error('fetch failed'));
    tx.pago.update.mockRejectedValue(new Error('base caída'));

    await expect(service.reintentar(TENANT_ID, PAGO_ID)).resolves.toMatchObject(
      { comprobante: null, error: 'fetch failed' },
    );
    expect(Logger.warn).toHaveBeenCalled();
  });

  it('con una emisión en curso para el pago, espera esa en lugar de emitir de nuevo', async () => {
    let terminar!: () => void;
    surtec.emitirETicket.mockReturnValue(
      new Promise((resolve) => {
        terminar = () => resolve(EMITIDO);
      }),
    );

    const primera = service.reintentar(TENANT_ID, PAGO_ID);
    const segunda = service.reintentar(TENANT_ID, PAGO_ID);
    while (!terminar) await Promise.resolve();
    terminar();

    await expect(primera).resolves.toMatchObject({ error: null });
    await expect(segunda).resolves.toMatchObject({ error: null });
    expect(surtec.emitirETicket).toHaveBeenCalledTimes(1);
  });

  it('la emisión en segundo plano que agota los reintentos cuenta como un intento', async () => {
    surtec.emitirETicket.mockRejectedValue(
      new SurtecError('no es un emisor válido', 400),
    );

    await service.emitirConReintentos(TENANT_ID, PAGO_ID);

    expect(tx.pago.update).toHaveBeenCalledTimes(1);
  });
});

describe('CfeService: PDF del comprobante (HU-009, BL-454)', () => {
  const PDF = Buffer.from('%PDF-1.4 prueba');
  const COMPROBANTE = {
    tipoCfe: '111',
    serie: 'A',
    numero: 49,
    proveedor: 'SURTEC',
    proveedorRef: '542442',
    urlPdf: null as string | null,
    pdfSha256: null as string | null,
  };
  let tx: {
    comprobanteFiscal: { findFirst: jest.Mock; findUnique: jest.Mock };
    tenant: { findUnique: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let surtec: { configurado: jest.Mock; obtenerPdf: jest.Mock };
  let service: CfeService;

  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
    tx = {
      comprobanteFiscal: {
        findFirst: jest.fn().mockResolvedValue(COMPROBANTE),
        findUnique: jest.fn().mockResolvedValue(COMPROBANTE),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ rut: '214198620015' }),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    surtec = {
      configurado: jest.fn().mockReturnValue(true),
      obtenerPdf: jest.fn().mockResolvedValue({ contenido: PDF }),
    };
    service = new CfeService(
      tenantPrisma as any,
      surtec as any,
      almacen as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('nombre del archivo: tipo, serie y número, sin datos del receptor', () => {
    expect(nombreArchivoPdf('111', 'A', 49)).toBe('e-Factura-A-0000049.pdf');
    expect(nombreArchivoPdf('101', 'B', 1234567)).toBe(
      'e-Ticket-B-1234567.pdf',
    );
  });

  it('del pedido: el comprobante más reciente, pedido a Surtec con el RUT del local y su id', async () => {
    const pdf = await service.pdfDelPedido(TENANT_ID, 'pedido-1');

    expect(tx.comprobanteFiscal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pedidoId: 'pedido-1' },
        orderBy: { fechaEmision: 'desc' },
      }),
    );
    expect(surtec.obtenerPdf).toHaveBeenCalledWith('214198620015', '542442');
    expect(pdf).toEqual({
      nombreArchivo: 'e-Factura-A-0000049.pdf',
      mimeType: 'application/pdf',
      contenido: PDF.toString('base64'),
    });
  });

  it('del admin: por id, dentro del tenant', async () => {
    await service.pdfDelComprobante(TENANT_ID, 'comprobante-1');

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(tx.comprobanteFiscal.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'comprobante-1' } }),
    );
  });

  it.each([
    ['sin comprobante (u otro tenant)', null],
    ['sin id de Surtec', { ...COMPROBANTE, proveedorRef: null }],
    ['de otro proveedor', { ...COMPROBANTE, proveedor: 'OTRO' }],
  ])('%s: 404 sin llamar a Surtec', async (_caso, comprobante) => {
    tx.comprobanteFiscal.findFirst.mockResolvedValue(comprobante);

    await expect(
      service.pdfDelPedido(TENANT_ID, 'pedido-1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(surtec.obtenerPdf).not.toHaveBeenCalled();
  });

  it('sin RUT del local: 404', async () => {
    tx.tenant.findUnique.mockResolvedValue(null);

    await expect(
      service.pdfDelComprobante(TENANT_ID, 'comprobante-1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('sin Surtec configurado: 503', async () => {
    surtec.configurado.mockReturnValue(false);

    await expect(
      service.pdfDelPedido(TENANT_ID, 'pedido-1'),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('si Surtec falla: 502 con un mensaje para el usuario; el log no tiene el RUT', async () => {
    surtec.obtenerPdf.mockRejectedValue(new SurtecError('caído', 503));

    await expect(
      service.pdfDelPedido(TENANT_ID, 'pedido-1'),
    ).rejects.toMatchObject({ status: 502 });
    const logs = JSON.stringify((Logger.warn as jest.Mock).mock.calls);
    expect(logs).toContain('A-49');
    expect(logs).not.toContain('214198620015');
  });

  describe('con la copia en S3', () => {
    const CLAVE = `${TENANT_ID}/cfe/2026/11/comprobante-1.pdf`;
    const GUARDADO = {
      ...COMPROBANTE,
      urlPdf: CLAVE,
      pdfSha256: sha256Hex(PDF),
    };

    beforeEach(() => {
      almacen.configurado.mockReturnValue(true);
      almacen.leer.mockResolvedValue(PDF);
      tx.comprobanteFiscal.findFirst.mockResolvedValue(GUARDADO);
    });

    it('sale de S3 si el hash coincide, sin llamar a Surtec (aunque no esté configurado)', async () => {
      surtec.configurado.mockReturnValue(false);

      const pdf = await service.pdfDelPedido(TENANT_ID, 'pedido-1');

      expect(almacen.leer).toHaveBeenCalledWith(CLAVE);
      expect(surtec.obtenerPdf).not.toHaveBeenCalled();
      expect(pdf).toEqual({
        nombreArchivo: 'e-Factura-A-0000049.pdf',
        mimeType: 'application/pdf',
        contenido: PDF.toString('base64'),
      });
    });

    it('si el hash no coincide: lo deja en el log y lo pide a Surtec', async () => {
      almacen.leer.mockResolvedValue(Buffer.from('%PDF-1.4 alterado'));

      await service.pdfDelPedido(TENANT_ID, 'pedido-1');

      expect(surtec.obtenerPdf).toHaveBeenCalled();
      expect(JSON.stringify((Logger.error as jest.Mock).mock.calls)).toContain(
        'no coincide con su SHA-256',
      );
    });

    it('si S3 falla: lo pide a Surtec', async () => {
      almacen.leer.mockRejectedValue(new Error('AccessDenied'));

      await service.pdfDelPedido(TENANT_ID, 'pedido-1');

      expect(surtec.obtenerPdf).toHaveBeenCalled();
    });

    it('sin S3_BUCKET_CFE: lo pide a Surtec sin leer S3', async () => {
      almacen.configurado.mockReturnValue(false);

      await service.pdfDelPedido(TENANT_ID, 'pedido-1');

      expect(almacen.leer).not.toHaveBeenCalled();
      expect(surtec.obtenerPdf).toHaveBeenCalled();
    });
  });
});

describe('CfeService: nota de crédito (HU-024, BL-104)', () => {
  const ORIGINAL = {
    id: 'cfe-1',
    tipoCfe: '101',
    serie: 'A',
    numero: 49,
    fechaEmision: new Date('2026-11-07T02:30:00Z'), // 6/11 en Uruguay
    urlConsulta: null,
  };
  const pagoDevuelto = (extra: Record<string, unknown> = {}) => ({
    id: PAGO_ID,
    pedidoId: PEDIDO_ID,
    estado: 'REEMBOLSADO',
    comprobantes: [ORIGINAL],
    pedido: {
      receptorRut: null,
      receptorRazonSocial: null,
      lineas: [
        {
          nombreSnapshot: 'Milanesa',
          cantidad: 1,
          precioUnitarioSnapshot: new Prisma.Decimal('590'),
        },
      ],
    },
    ...extra,
  });
  let tx: {
    pago: { findUnique: jest.Mock; update: jest.Mock };
    tenant: { findUnique: jest.Mock };
    comprobanteFiscal: { upsert: jest.Mock };
  };
  let surtec: { configurado: jest.Mock; emitirNotaDeCredito: jest.Mock };
  let service: CfeService;

  beforeEach(() => {
    jest.spyOn(Logger, 'error').mockImplementation();
    jest.spyOn(Logger, 'warn').mockImplementation();
    tx = {
      pago: {
        findUnique: jest.fn().mockResolvedValue(pagoDevuelto()),
        update: jest.fn().mockResolvedValue({}),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ rut: '214198620015' }),
      },
      comprobanteFiscal: {
        upsert: jest.fn(({ create }) =>
          Promise.resolve({ ...create, urlConsulta: null }),
        ),
      },
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    surtec = {
      configurado: jest.fn().mockReturnValue(true),
      emitirNotaDeCredito: jest.fn().mockResolvedValue({
        id: '600001',
        serie: 'A',
        numero: 7,
        hash: 'h',
      }),
    };
    service = new CfeService(
      tenantPrisma as any,
      surtec as any,
      almacen as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('emite la NC del e-Ticket con las mismas líneas y la referencia al original (fecha en Uruguay), y la guarda como 102', async () => {
    const resultado = await service.reintentarNotaDeCredito(TENANT_ID, PAGO_ID);

    expect(surtec.emitirNotaDeCredito).toHaveBeenCalledWith(
      {
        rutEmisor: '214198620015',
        idExterno: `bl-${PAGO_ID}-nc`,
        items: [{ concepto: 'Milanesa', cantidad: 1, precio: 590 }],
        adenda: `Cancelación del pedido ${PEDIDO_ID.slice(0, 8)}`,
      },
      {
        tipoComprobante: 101,
        serie: 'A',
        numero: 49,
        fecha: '2026-11-06',
        razon: 'Cancelación del pedido',
      },
      undefined,
    );
    expect(tx.comprobanteFiscal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idExterno: `bl-${PAGO_ID}-nc` },
        create: expect.objectContaining({ tipoCfe: '102', pagoId: PAGO_ID }),
      }),
    );
    expect(resultado).toEqual({
      comprobante: { tipoCfe: '102', serie: 'A', numero: 7, urlConsulta: null },
      error: null,
    });
  });

  it('la de una e-Factura va con el receptor del pedido', async () => {
    tx.pago.findUnique.mockResolvedValue(
      pagoDevuelto({
        comprobantes: [{ ...ORIGINAL, tipoCfe: '111' }],
        pedido: {
          ...pagoDevuelto().pedido,
          receptorRut: '219999830019',
          receptorRazonSocial: 'Comensal SAS',
        },
      }),
    );

    await service.reintentarNotaDeCredito(TENANT_ID, PAGO_ID);

    expect(surtec.emitirNotaDeCredito.mock.calls[0][1].tipoComprobante).toBe(
      111,
    );
    expect(surtec.emitirNotaDeCredito.mock.calls[0][2]).toEqual({
      rut: '219999830019',
      razonSocial: 'Comensal SAS',
    });
    expect(tx.comprobanteFiscal.upsert.mock.calls[0][0].create.tipoCfe).toBe(
      '112',
    );
  });

  it.each([
    ['el pago no está devuelto', { estado: 'APROBADO' }],
    ['el pago no tenía CFE', { comprobantes: [] }],
  ])('%s: no emite nada', async (_caso, extra) => {
    tx.pago.findUnique.mockResolvedValue(pagoDevuelto(extra));

    await expect(
      service.reintentarNotaDeCredito(TENANT_ID, PAGO_ID),
    ).resolves.toEqual({ comprobante: null, error: null });
    expect(surtec.emitirNotaDeCredito).not.toHaveBeenCalled();
  });

  it('si ya tiene la NC, la devuelve sin volver a emitir', async () => {
    tx.pago.findUnique.mockResolvedValue(
      pagoDevuelto({
        comprobantes: [ORIGINAL, { ...ORIGINAL, tipoCfe: '102', numero: 7 }],
      }),
    );

    const { comprobante } = await service.reintentarNotaDeCredito(
      TENANT_ID,
      PAGO_ID,
    );

    expect(comprobante).toMatchObject({ tipoCfe: '102', numero: 7 });
    expect(surtec.emitirNotaDeCredito).not.toHaveBeenCalled();
  });

  it('sin Surtec configurado no hace nada', async () => {
    surtec.configurado.mockReturnValue(false);

    await expect(
      service.reintentarNotaDeCredito(TENANT_ID, PAGO_ID),
    ).resolves.toEqual({ comprobante: null, error: null });
  });

  it('si Surtec falla: registra el intento en el pago (para la conciliación) y no lanza', async () => {
    surtec.emitirNotaDeCredito.mockRejectedValue(new SurtecError('caído', 503));

    const resultado = await service.reintentarNotaDeCredito(TENANT_ID, PAGO_ID);

    expect(resultado.comprobante).toBeNull();
    expect(resultado.error).toContain('caído');
    expect(tx.pago.update).toHaveBeenCalledWith({
      where: { id: PAGO_ID },
      data: expect.objectContaining({ cfeIntentos: { increment: 1 } }),
    });
  });

  it('en segundo plano: lanza el intento sin esperar', async () => {
    service.emitirNotaDeCreditoEnSegundoPlano(TENANT_ID, PAGO_ID);
    await new Promise((r) => setImmediate(r));

    expect(surtec.emitirNotaDeCredito).toHaveBeenCalled();
  });

  it('dos intentos a la vez del mismo pago emiten una sola vez', async () => {
    const [a, b] = await Promise.all([
      service.reintentarNotaDeCredito(TENANT_ID, PAGO_ID),
      service.reintentarNotaDeCredito(TENANT_ID, PAGO_ID),
    ]);

    expect(surtec.emitirNotaDeCredito).toHaveBeenCalledTimes(1);
    expect(a.comprobante).toEqual(b.comprobante);
  });
});
