import { Logger } from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  AlmacenCfe,
  clavePdfCfe,
  sha256Hex,
} from '../../src/cfe/respaldo-pdf/almacen-cfe';
import { configuracionRespaldoPdf } from '../../src/cfe/respaldo-pdf/configuracion-respaldo-pdf';
import { RespaldoPdfService } from '../../src/cfe/respaldo-pdf/respaldo-pdf.service';
import { RespaldoPdfJob } from '../../src/cfe/respaldo-pdf/respaldo-pdf.job';
import { SurtecError } from '../../src/cfe/surtec.client';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const COMPROBANTE_ID = '0b6a0c55-6d5c-4f45-9e7d-6a1f7c1d2e3f';
const PDF = Buffer.from('%PDF-1.4 prueba BL-454');
const RUT = '214198620015';
const MINUTO = 60_000;

describe('Respaldo del PDF de los CFE: clave y hash (HU-009, BL-454)', () => {
  it('clave del Anexo 6: tenant, año y mes de la emisión en hora de Uruguay, id', () => {
    expect(
      clavePdfCfe(TENANT_ID, new Date('2026-11-05T15:00:00Z'), COMPROBANTE_ID),
    ).toBe(`${TENANT_ID}/cfe/2026/11/${COMPROBANTE_ID}.pdf`);
    // 1 de diciembre 01:00 UTC es todavía 30 de noviembre en Uruguay.
    expect(
      clavePdfCfe(TENANT_ID, new Date('2026-12-01T01:00:00Z'), COMPROBANTE_ID),
    ).toBe(`${TENANT_ID}/cfe/2026/11/${COMPROBANTE_ID}.pdf`);
  });

  it('SHA-256 en hexadecimal', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('el almacén está configurado solo con S3_BUCKET_CFE', () => {
    const anterior = process.env.S3_BUCKET_CFE;
    try {
      delete process.env.S3_BUCKET_CFE;
      expect(new AlmacenCfe().configurado()).toBe(false);
      process.env.S3_BUCKET_CFE = '  ';
      expect(new AlmacenCfe().configurado()).toBe(false);
      process.env.S3_BUCKET_CFE = 'bucket-cfe';
      expect(new AlmacenCfe().configurado()).toBe(true);
    } finally {
      if (anterior === undefined) delete process.env.S3_BUCKET_CFE;
      else process.env.S3_BUCKET_CFE = anterior;
    }
  });
});

describe('AlmacenCfe (BL-454)', () => {
  const anterior = process.env.S3_BUCKET_CFE;
  let send: jest.SpyInstance;

  beforeEach(() => {
    process.env.S3_BUCKET_CFE = 'bucket-cfe';
    send = jest.spyOn(S3Client.prototype, 'send');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (anterior === undefined) delete process.env.S3_BUCKET_CFE;
    else process.env.S3_BUCKET_CFE = anterior;
  });

  it('guarda el PDF en el bucket de los CFE con su tipo y checksum SHA-256', async () => {
    send.mockResolvedValue({});

    await new AlmacenCfe().guardarPdf('t/cfe/2026/11/c.pdf', PDF);

    const comando = send.mock.calls[0][0] as PutObjectCommand;
    expect(comando).toBeInstanceOf(PutObjectCommand);
    expect(comando.input).toEqual({
      Bucket: 'bucket-cfe',
      Key: 't/cfe/2026/11/c.pdf',
      Body: PDF,
      ContentType: 'application/pdf',
      ChecksumAlgorithm: 'SHA256',
    });
  });

  it('lee el objeto del bucket de los CFE', async () => {
    send.mockResolvedValue({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array(PDF)),
      },
    });

    await expect(new AlmacenCfe().leer('t/cfe/2026/11/c.pdf')).resolves.toEqual(
      PDF,
    );
    const comando = send.mock.calls[0][0] as GetObjectCommand;
    expect(comando).toBeInstanceOf(GetObjectCommand);
    expect(comando.input).toEqual({
      Bucket: 'bucket-cfe',
      Key: 't/cfe/2026/11/c.pdf',
    });
  });

  it('si S3 devuelve el objeto sin contenido, lanza', async () => {
    send.mockResolvedValue({});

    await expect(new AlmacenCfe().leer('x.pdf')).rejects.toThrow(
      'sin contenido',
    );
  });
});

describe('configuracionRespaldoPdf (BL-454)', () => {
  it('valores por defecto: cada 5 min, 7 días, 10 intentos, lote de 20', () => {
    expect(configuracionRespaldoPdf({ NODE_ENV: 'production' })).toEqual({
      habilitado: true,
      intervaloMs: 5 * MINUTO,
      dias: 7,
      maxIntentos: 10,
      lote: 20,
    });
  });

  it('en los tests está apagado salvo que se habilite', () => {
    expect(configuracionRespaldoPdf({ NODE_ENV: 'test' }).habilitado).toBe(
      false,
    );
    expect(
      configuracionRespaldoPdf({
        NODE_ENV: 'test',
        CFE_RESPALDO_PDF_HABILITADO: 'true',
      }).habilitado,
    ).toBe(true);
  });

  it('lee las variables y descarta valores inválidos', () => {
    expect(
      configuracionRespaldoPdf({
        NODE_ENV: 'production',
        CFE_RESPALDO_PDF_HABILITADO: 'FALSE',
        CFE_RESPALDO_PDF_INTERVALO_MIN: '10',
        CFE_RESPALDO_PDF_DIAS: '60',
        CFE_RESPALDO_PDF_MAX_INTENTOS: '0',
        CFE_RESPALDO_PDF_LOTE: 'abc',
      }),
    ).toEqual({
      habilitado: false,
      intervaloMs: 10 * MINUTO,
      dias: 60,
      maxIntentos: 10,
      lote: 20,
    });
  });
});

describe('RespaldoPdfService (BL-454)', () => {
  const AHORA = new Date('2026-11-07T15:00:00Z');
  const CONFIG = { dias: 7, maxIntentos: 10, lote: 20 };
  const COMPROBANTE = {
    serie: 'A',
    numero: 49,
    proveedorRef: '542442',
    fechaEmision: new Date('2026-11-07T14:00:00Z'),
    urlPdf: null as string | null,
  };
  let tx: {
    comprobanteFiscal: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    tenant: { findUnique: jest.Mock };
  };
  let surtec: { configurado: jest.Mock; obtenerPdf: jest.Mock };
  let almacen: { configurado: jest.Mock; guardarPdf: jest.Mock };
  let service: RespaldoPdfService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    tx = {
      comprobanteFiscal: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(COMPROBANTE),
        update: jest.fn().mockResolvedValue({}),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ rut: RUT }) },
    };
    surtec = {
      configurado: jest.fn().mockReturnValue(true),
      obtenerPdf: jest.fn().mockResolvedValue({ contenido: PDF }),
    };
    almacen = {
      configurado: jest.fn().mockReturnValue(true),
      guardarPdf: jest.fn().mockResolvedValue(undefined),
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    service = new RespaldoPdfService(
      tenantPrisma as any,
      surtec as any,
      almacen as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('guarda el PDF de Surtec en S3 con la clave del Anexo 6 y registra la clave y el SHA-256', async () => {
    await expect(service.guardarPdf(TENANT_ID, COMPROBANTE_ID)).resolves.toBe(
      true,
    );

    const clave = `${TENANT_ID}/cfe/2026/11/${COMPROBANTE_ID}.pdf`;
    expect(surtec.obtenerPdf).toHaveBeenCalledWith(RUT, '542442');
    expect(almacen.guardarPdf).toHaveBeenCalledWith(clave, PDF);
    expect(tx.comprobanteFiscal.update).toHaveBeenCalledWith({
      where: { id: COMPROBANTE_ID },
      data: { urlPdf: clave, pdfSha256: sha256Hex(PDF) },
    });
  });

  it('si ya está guardado no hace nada', async () => {
    tx.comprobanteFiscal.findUnique.mockResolvedValue({
      ...COMPROBANTE,
      urlPdf: 'ya/guardado.pdf',
    });

    await expect(service.guardarPdf(TENANT_ID, COMPROBANTE_ID)).resolves.toBe(
      true,
    );
    expect(surtec.obtenerPdf).not.toHaveBeenCalled();
  });

  it('sin comprobante (u otro tenant) o sin RUT: false, sin llamar a Surtec', async () => {
    tx.comprobanteFiscal.findUnique.mockResolvedValueOnce(null);
    await expect(service.guardarPdf(TENANT_ID, COMPROBANTE_ID)).resolves.toBe(
      false,
    );
    tx.tenant.findUnique.mockResolvedValueOnce(null);
    await expect(service.guardarPdf(TENANT_ID, COMPROBANTE_ID)).resolves.toBe(
      false,
    );
    expect(surtec.obtenerPdf).not.toHaveBeenCalled();
  });

  it.each([
    [
      'Surtec',
      () => surtec.obtenerPdf.mockRejectedValue(new SurtecError('caído', 503)),
    ],
    [
      'S3',
      () => almacen.guardarPdf.mockRejectedValue(new Error('AccessDenied')),
    ],
  ])(
    'si falla %s: suma un intento, no guarda la clave y el log no tiene el RUT',
    async (_caso, fallar) => {
      fallar();

      await expect(service.guardarPdf(TENANT_ID, COMPROBANTE_ID)).resolves.toBe(
        false,
      );
      expect(tx.comprobanteFiscal.update).toHaveBeenCalledTimes(1);
      expect(tx.comprobanteFiscal.update).toHaveBeenCalledWith({
        where: { id: COMPROBANTE_ID },
        data: {
          pdfIntentos: { increment: 1 },
          pdfUltimoIntentoEn: expect.any(Date),
        },
      });
      const logs = JSON.stringify(
        (Logger.prototype.warn as jest.Mock).mock.calls,
      );
      expect(logs).toContain('A-49');
      expect(logs).not.toContain(RUT);
    },
  );

  it('si tampoco se puede registrar el intento, no lanza', async () => {
    surtec.obtenerPdf.mockRejectedValue(new SurtecError('caído', 503));
    tx.comprobanteFiscal.update.mockRejectedValue(new Error('sin base'));

    await expect(service.guardarPdf(TENANT_ID, COMPROBANTE_ID)).resolves.toBe(
      false,
    );
  });

  it('busca los de Surtec sin PDF guardado de los últimos días y con menos intentos que el máximo', async () => {
    await service.respaldarTenant(TENANT_ID, CONFIG, AHORA);

    expect(tx.comprobanteFiscal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          proveedor: 'SURTEC',
          proveedorRef: { not: null },
          urlPdf: null,
          pdfIntentos: { lt: 10 },
          fechaEmision: {
            gte: new Date('2026-10-31T15:00:00Z'),
            lte: new Date('2026-11-07T14:58:00Z'),
          },
        },
        orderBy: { fechaEmision: 'asc' },
      }),
    );
  });

  it('guarda solo los que les toca según la espera entre intentos, hasta el lote', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValue([
      // Nunca falló: toca.
      {
        id: 'c1',
        fechaEmision: COMPROBANTE.fechaEmision,
        pdfIntentos: 0,
        pdfUltimoIntentoEn: null,
      },
      // Falló hace 1 min (espera 5 min): no toca.
      {
        id: 'c2',
        fechaEmision: COMPROBANTE.fechaEmision,
        pdfIntentos: 1,
        pdfUltimoIntentoEn: new Date(AHORA.getTime() - MINUTO),
      },
      // Falló hace 10 min (espera 5 min): toca.
      {
        id: 'c3',
        fechaEmision: COMPROBANTE.fechaEmision,
        pdfIntentos: 1,
        pdfUltimoIntentoEn: new Date(AHORA.getTime() - 10 * MINUTO),
      },
    ]);
    surtec.obtenerPdf
      .mockResolvedValueOnce({ contenido: PDF })
      .mockRejectedValueOnce(new SurtecError('caído', 503));

    const resumen = await service.respaldarTenant(
      TENANT_ID,
      { ...CONFIG, lote: 5 },
      AHORA,
    );

    expect(resumen).toEqual({ revisados: 2, guardados: 1, fallidos: 1 });
    expect(
      tx.comprobanteFiscal.findUnique.mock.calls.map((c) => c[0].where.id),
    ).toEqual(['c1', 'c3']);
  });

  it.each([
    ['sin S3_BUCKET_CFE', () => almacen.configurado.mockReturnValue(false)],
    ['sin Surtec', () => surtec.configurado.mockReturnValue(false)],
  ])('%s no hace nada', async (_caso, apagar) => {
    apagar();

    await expect(
      service.respaldarTenant(TENANT_ID, CONFIG, AHORA),
    ).resolves.toEqual({ revisados: 0, guardados: 0, fallidos: 0 });
    expect(tx.comprobanteFiscal.findMany).not.toHaveBeenCalled();
  });
});

describe('RespaldoPdfJob (BL-454)', () => {
  let servicio: { respaldarTenant: jest.Mock };
  let job: RespaldoPdfJob;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    servicio = {
      respaldarTenant: jest
        .fn()
        .mockResolvedValueOnce({ revisados: 2, guardados: 1, fallidos: 1 })
        .mockRejectedValueOnce(new Error('falló'))
        .mockResolvedValue({ revisados: 1, guardados: 1, fallidos: 0 }),
    };
    const moduleRef = { resolve: jest.fn().mockResolvedValue(servicio) };
    const prisma = {
      tenant: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 't1' }, { id: 't2' }, { id: 't3' }]),
      },
    };
    job = new RespaldoPdfJob(moduleRef as any, prisma as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('recorre los establecimientos de a uno; un error no frena a los demás', async () => {
    await expect(job.ejecutar()).resolves.toEqual({
      revisados: 3,
      guardados: 2,
      fallidos: 1,
    });
    expect(servicio.respaldarTenant).toHaveBeenCalledTimes(3);
  });

  it('apagado en los tests: no programa nada', () => {
    const setInterval = jest.spyOn(global, 'setInterval');
    job.onApplicationBootstrap();
    expect(setInterval).not.toHaveBeenCalled();
    job.onModuleDestroy();
  });

  it('habilitado: programa la corrida con un timer que no frena el apagado', () => {
    process.env.CFE_RESPALDO_PDF_HABILITADO = 'true';
    try {
      const unref = jest.fn();
      const setInterval = jest
        .spyOn(global, 'setInterval')
        .mockReturnValue({ unref } as unknown as NodeJS.Timeout);
      const habilitado = new RespaldoPdfJob(
        { resolve: jest.fn() } as any,
        { tenant: { findMany: jest.fn() } } as any,
      );
      const ejecutar = jest
        .spyOn(habilitado, 'ejecutar')
        .mockResolvedValue(null);
      habilitado.onApplicationBootstrap();
      expect(setInterval).toHaveBeenCalledWith(
        expect.any(Function),
        5 * MINUTO,
      );
      expect(unref).toHaveBeenCalled();

      // Cada tick del timer lanza una corrida.
      (setInterval.mock.calls[0][0] as () => void)();
      expect(ejecutar).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.CFE_RESPALDO_PDF_HABILITADO;
    }
  });

  it('si no puede leer los establecimientos, no lanza', async () => {
    const roto = new RespaldoPdfJob(
      { resolve: jest.fn().mockResolvedValue(servicio) } as any,
      {
        tenant: {
          findMany: jest.fn().mockRejectedValue(new Error('sin base')),
        },
      } as any,
    );

    await expect(roto.ejecutar()).resolves.toEqual({
      revisados: 0,
      guardados: 0,
      fallidos: 0,
    });
  });
});
