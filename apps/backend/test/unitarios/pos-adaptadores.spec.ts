import { Logger } from '@nestjs/common';
import {
  configuracionPos,
  urlPosValida,
} from '../../src/pos/configuracion-pos';
import { PosMockAdapter } from '../../src/pos/pos-mock.adapter';
import { PosHttpAdapter } from '../../src/pos/pos-http.adapter';
import {
  PosNoDisponibleError,
  PosRechazoError,
  VentaPos,
} from '../../src/pos/pos.adapter';
import {
  adaptadorPosDelEntorno,
  crearAdaptadorPos,
} from '../../src/pos/pos.module';
import {
  ESPERA_INICIAL_MS,
  esperaDespuesDe,
  proximoIntentoPos,
  tocaReintentarPos,
} from '../../src/pos/reintentos-pos';

// HU-011 (BL-488): puerto del POS del local, sus adaptadores y la
// configuración.

const VENTA: VentaPos = {
  referencia: 'pedido-1',
  fecha: '2026-11-08T15:00:00.000Z',
  moneda: 'UYU',
  total: 590,
  medioPago: 'EFECTIVO',
  mesa: 4,
  lineas: [
    {
      descripcion: 'Milanesa',
      cantidad: 1,
      precioUnitario: 590,
      subtotal: 590,
    },
  ],
};

const MINUTO = 60_000;

describe('configuracionPos (BL-488)', () => {
  it('por defecto: mock disponible, job prendido fuera de los tests, cada 60 s, 10 intentos, lote 20, 5 s de timeout', () => {
    expect(configuracionPos({ NODE_ENV: 'production' })).toEqual({
      adaptador: 'mock',
      apiUrl: null,
      apiToken: null,
      mockDisponible: true,
      jobHabilitado: true,
      intervaloMs: 60_000,
      maxIntentos: 10,
      lote: 20,
      timeoutMs: 5000,
    });
  });

  it('en los tests el job está apagado salvo que se habilite', () => {
    expect(configuracionPos({ NODE_ENV: 'test' }).jobHabilitado).toBe(false);
    expect(
      configuracionPos({
        NODE_ENV: 'test',
        POS_SINCRONIZACION_HABILITADA: 'true',
      }).jobHabilitado,
    ).toBe(true);
    expect(
      configuracionPos({
        NODE_ENV: 'production',
        POS_SINCRONIZACION_HABILITADA: 'false',
      }).jobHabilitado,
    ).toBe(false);
  });

  it('lee el adaptador, la API, el mock caído y los números', () => {
    expect(
      configuracionPos({
        POS_ADAPTER: ' HTTP ',
        POS_API_URL: ' https://pos.ejemplo.uy ',
        POS_API_TOKEN: 'secreto',
        POS_MOCK_DISPONIBLE: 'false',
        POS_SINCRONIZACION_INTERVALO_SEG: '30',
        POS_SINCRONIZACION_MAX_INTENTOS: '3',
        POS_SINCRONIZACION_LOTE: '5',
        POS_TIMEOUT_MS: '2000',
      }),
    ).toMatchObject({
      adaptador: 'http',
      apiUrl: 'https://pos.ejemplo.uy',
      apiToken: 'secreto',
      mockDisponible: false,
      intervaloMs: 30_000,
      maxIntentos: 3,
      lote: 5,
      timeoutMs: 2000,
    });
    expect(configuracionPos({ POS_ADAPTER: 'deshabilitado' }).adaptador).toBe(
      'deshabilitado',
    );
  });

  it('valores inválidos o vacíos: los de por defecto', () => {
    expect(
      configuracionPos({
        POS_ADAPTER: 'otro',
        POS_API_URL: '  ',
        POS_SINCRONIZACION_INTERVALO_SEG: 'abc',
        POS_SINCRONIZACION_MAX_INTENTOS: '0',
        POS_SINCRONIZACION_LOTE: '',
      }),
    ).toMatchObject({
      adaptador: 'mock',
      apiUrl: null,
      intervaloMs: 60_000,
      maxIntentos: 10,
      lote: 20,
    });
  });

  it('la URL del POS tiene que ser HTTPS; http solo contra localhost', () => {
    expect(urlPosValida('https://pos.ejemplo.uy/api')).toBe(true);
    expect(urlPosValida('http://localhost:8080')).toBe(true);
    expect(urlPosValida('http://127.0.0.1:8080')).toBe(true);
    expect(urlPosValida('http://pos.ejemplo.uy')).toBe(false);
    expect(urlPosValida('ftp://pos.ejemplo.uy')).toBe(false);
    expect(urlPosValida('no es una url')).toBe(false);
  });
});

describe('reintentos de la sincronización (BL-488)', () => {
  const creada = new Date('2026-11-08T15:00:00Z');

  it('recién encolada: el job espera 30 s (el envío inmediato ya la está mandando)', () => {
    const envio = { createdAt: creada, intentos: 0, ultimoIntentoEn: null };
    expect(proximoIntentoPos(envio)).toEqual(
      new Date(creada.getTime() + ESPERA_INICIAL_MS),
    );
    expect(tocaReintentarPos(envio, new Date(creada.getTime() + 29_000))).toBe(
      false,
    );
    expect(tocaReintentarPos(envio, new Date(creada.getTime() + 30_000))).toBe(
      true,
    );
  });

  it('la espera crece: 1, 5, 15 y 60 min, y después cada 6 h', () => {
    expect(esperaDespuesDe(0)).toBe(0);
    expect(esperaDespuesDe(1)).toBe(1 * MINUTO);
    expect(esperaDespuesDe(2)).toBe(5 * MINUTO);
    expect(esperaDespuesDe(3)).toBe(15 * MINUTO);
    expect(esperaDespuesDe(4)).toBe(60 * MINUTO);
    expect(esperaDespuesDe(5)).toBe(6 * 60 * MINUTO);
    expect(esperaDespuesDe(9)).toBe(6 * 60 * MINUTO);
  });

  it('después de un fallo, cuenta desde el último intento', () => {
    const ultimo = new Date('2026-11-08T16:00:00Z');
    const envio = { createdAt: creada, intentos: 2, ultimoIntentoEn: ultimo };
    expect(proximoIntentoPos(envio)).toEqual(
      new Date(ultimo.getTime() + 5 * MINUTO),
    );
  });
});

describe('PosMockAdapter (BL-488)', () => {
  it('registra la venta y es idempotente por referencia', async () => {
    const pos = new PosMockAdapter();
    const primera = await pos.registrarVenta(VENTA);
    const segunda = await pos.registrarVenta({ ...VENTA, total: 1 });

    expect(primera.idPos).toMatch(/^MOCK-/);
    expect(segunda).toEqual(primera);
    expect(pos.ventasRegistradas()).toHaveLength(1);
    expect(pos.ventasRegistradas()[0].venta.total).toBe(590);
  });

  it('anula una venta que tiene; una que no tiene es un rechazo (404)', async () => {
    const pos = new PosMockAdapter();
    const { idPos } = await pos.registrarVenta(VENTA);

    await pos.anularVenta(idPos);
    expect(pos.ventasRegistradas()[0].anulada).toBe(true);

    const error = await pos.anularVenta('MOCK-otra').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PosRechazoError);
    expect((error as PosRechazoError).status).toBe(404);
  });

  it('caído: todo falla con PosNoDisponibleError, y al volver funciona', async () => {
    const pos = new PosMockAdapter(false);
    await expect(pos.registrarVenta(VENTA)).rejects.toBeInstanceOf(
      PosNoDisponibleError,
    );
    await expect(pos.anularVenta('MOCK-1')).rejects.toBeInstanceOf(
      PosNoDisponibleError,
    );

    pos.disponible = true;
    await expect(pos.registrarVenta(VENTA)).resolves.toEqual({
      idPos: expect.stringMatching(/^MOCK-/),
    });
  });
});

describe('PosHttpAdapter (BL-488)', () => {
  let fetchMock: jest.SpyInstance;
  const respuesta = (status: number, cuerpo?: unknown) =>
    Promise.resolve(
      new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
        status,
      }),
    );
  const crear = () =>
    new PosHttpAdapter('https://pos.ejemplo.uy/api/', 'token-pos', 1234);

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('solo acepta URL HTTPS (o localhost)', () => {
    expect(() => new PosHttpAdapter('http://pos.ejemplo.uy', 't')).toThrow(
      'HTTPS',
    );
    expect(
      () => new PosHttpAdapter('http://localhost:9000', 't'),
    ).not.toThrow();
  });

  it('registrar: POST /ventas con Bearer y JSON; 201 devuelve el id del POS', async () => {
    fetchMock.mockReturnValueOnce(respuesta(201, { id: 'POS-77' }));

    await expect(crear().registrarVenta(VENTA)).resolves.toEqual({
      idPos: 'POS-77',
    });
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe('https://pos.ejemplo.uy/api/ventas');
    expect(opciones.method).toBe('POST');
    expect(opciones.headers).toEqual({
      Authorization: 'Bearer token-pos',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(JSON.parse(opciones.body)).toEqual(VENTA);
    expect(opciones.signal).toBeInstanceOf(AbortSignal);
  });

  it('registrar: 409 (ya existía esa referencia) devuelve la venta existente; un id numérico se pasa a texto', async () => {
    fetchMock.mockReturnValueOnce(respuesta(409, { id: 77 }));
    await expect(crear().registrarVenta(VENTA)).resolves.toEqual({
      idPos: '77',
    });
  });

  it('registrar: sin id en la respuesta, o sin JSON, es un rechazo', async () => {
    fetchMock
      .mockReturnValueOnce(respuesta(201, {}))
      .mockReturnValueOnce(
        Promise.resolve(new Response('no es json', { status: 201 })),
      );
    await expect(crear().registrarVenta(VENTA)).rejects.toBeInstanceOf(
      PosRechazoError,
    );
    await expect(crear().registrarVenta(VENTA)).rejects.toThrow(
      'no devolvió su id',
    );
  });

  it('5xx y 429: POS no disponible (se reintenta); otro 4xx: rechazo; nunca el cuerpo en el mensaje', async () => {
    fetchMock
      .mockReturnValueOnce(respuesta(503, { detalle: 'dato del comensal' }))
      .mockReturnValueOnce(respuesta(429))
      .mockReturnValueOnce(respuesta(422, { detalle: 'dato del comensal' }));

    const caido = await crear()
      .registrarVenta(VENTA)
      .catch((e: unknown) => e);
    expect(caido).toBeInstanceOf(PosNoDisponibleError);
    expect((caido as Error).message).toBe(
      'El POS no pudo registrar la venta (HTTP 503)',
    );
    await expect(crear().registrarVenta(VENTA)).rejects.toBeInstanceOf(
      PosNoDisponibleError,
    );
    const rechazo = await crear()
      .registrarVenta(VENTA)
      .catch((e: unknown) => e);
    expect(rechazo).toBeInstanceOf(PosRechazoError);
    expect((rechazo as PosRechazoError).status).toBe(422);
    expect((rechazo as Error).message).not.toContain('comensal');
  });

  it('sin red o timeout: POS no disponible', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    );
    await expect(crear().registrarVenta(VENTA)).rejects.toThrow(
      'El POS no respondió: TimeoutError',
    );
  });

  it('anular: POST /ventas/{id}/anulacion con el motivo; 200 o 409 (ya anulada) está bien', async () => {
    fetchMock
      .mockReturnValueOnce(respuesta(200, {}))
      .mockReturnValueOnce(respuesta(409));

    await crear().anularVenta('POS 77', 'Pedido cancelado');
    await crear().anularVenta('POS-77', 'Pedido cancelado');

    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe('https://pos.ejemplo.uy/api/ventas/POS%2077/anulacion');
    expect(JSON.parse(opciones.body)).toEqual({ motivo: 'Pedido cancelado' });
  });

  it('anular: 404 es un rechazo; 502 es POS no disponible', async () => {
    fetchMock
      .mockReturnValueOnce(respuesta(404))
      .mockReturnValueOnce(respuesta(502));
    await expect(crear().anularVenta('x', 'm')).rejects.toBeInstanceOf(
      PosRechazoError,
    );
    await expect(crear().anularVenta('x', 'm')).rejects.toThrow(
      'El POS no pudo anular la venta (HTTP 502)',
    );
  });
});

describe('crearAdaptadorPos (BL-488)', () => {
  const base = configuracionPos({});

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('el provider lee el entorno: en los tests, el mock', () => {
    expect(adaptadorPosDelEntorno()).toBeInstanceOf(PosMockAdapter);
  });

  it('el error de POS no disponible tiene un mensaje por defecto', () => {
    expect(new PosNoDisponibleError().message).toBe(
      'El POS no está disponible',
    );
  });

  it('deshabilitado: sin POS', () => {
    expect(crearAdaptadorPos({ ...base, adaptador: 'deshabilitado' })).toBe(
      null,
    );
  });

  it('mock: el POS de prueba, caído si POS_MOCK_DISPONIBLE=false', () => {
    const pos = crearAdaptadorPos({ ...base, mockDisponible: false });
    expect(pos).toBeInstanceOf(PosMockAdapter);
    expect((pos as PosMockAdapter).disponible).toBe(false);
  });

  it('http: con URL HTTPS y token', () => {
    expect(
      crearAdaptadorPos({
        ...base,
        adaptador: 'http',
        apiUrl: 'https://pos.ejemplo.uy',
        apiToken: 't',
      }),
    ).toBeInstanceOf(PosHttpAdapter);
  });

  it('http sin URL o token, o con URL no HTTPS: sin POS y error en el log (la API arranca igual)', () => {
    expect(
      crearAdaptadorPos({ ...base, adaptador: 'http', apiToken: 't' }),
    ).toBeNull();
    expect(
      crearAdaptadorPos({
        ...base,
        adaptador: 'http',
        apiUrl: 'http://pos.ejemplo.uy',
        apiToken: 't',
      }),
    ).toBeNull();
    expect(Logger.prototype.error).toHaveBeenCalledTimes(2);
  });
});
