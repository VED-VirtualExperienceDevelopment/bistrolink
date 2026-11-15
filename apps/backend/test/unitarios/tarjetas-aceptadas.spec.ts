import { Logger } from '@nestjs/common';
import {
  marcaDelMedio,
  type MedioDePagoMp,
  tarjetasAceptadas,
} from '../../src/pagos/tarjetas/tarjetas-aceptadas';
import {
  REINTENTO_TARJETAS_MS,
  TarjetasAceptadasService,
  VIGENCIA_TARJETAS_MS,
} from '../../src/pagos/tarjetas/tarjetas-aceptadas.service';
import { TarjetasAceptadasController } from '../../src/pagos/tarjetas/tarjetas-aceptadas.controller';

/** HU-051 (BL-563): tarjetas aceptadas para el sello de pago seguro. */

const img = (id: string) => `https://http2.mlstatic.com/${id}.gif`;
const medio = (
  id: string,
  name: string,
  tipo: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name,
  payment_type_id: tipo,
  status: 'active',
  secure_thumbnail: img(id),
  ...extra,
});

// Como la responde Mercado Pago (Uruguay), con cosas que hay que filtrar.
const RESPUESTA_MP = [
  medio('oca', 'OCA', 'credit_card'),
  medio('debvisa', 'Visa Débito', 'debit_card'),
  medio('master', 'Mastercard', 'credit_card'),
  medio('visa', 'Visa', 'credit_card'),
  medio('debmaster', 'Mastercard Débito', 'debit_card'),
  medio('abitab', 'Abitab', 'ticket'),
  medio('zeta', 'Zeta', 'credit_card'),
  medio('creditel', 'Creditel', 'credit_card', { status: 'inactive' }),
  medio('lider', 'Líder', 'credit_card', {
    secure_thumbnail: 'http://x/l.gif',
  }),
  { id: 42, name: 'Rara' },
  {},
] as MedioDePagoMp[];

describe('tarjetasAceptadas', () => {
  it('una por marca, en orden (las más usadas primero), con crédito y débito juntas', () => {
    const lista = tarjetasAceptadas(RESPUESTA_MP);
    expect(lista.map((t) => t.id)).toEqual([
      'visa',
      'master',
      'oca',
      'lider',
      'zeta',
    ]);
    expect(lista[0]).toEqual({
      id: 'visa',
      nombre: 'Visa',
      imagen: img('visa'),
      credito: true,
      debito: true,
    });
    expect(lista.find((t) => t.id === 'oca')).toMatchObject({
      credito: true,
      debito: false,
    });
  });

  it('sin medios que no son tarjeta, inactivos o sin forma', () => {
    const ids = tarjetasAceptadas(RESPUESTA_MP).map((t) => t.id);
    expect(ids).not.toContain('abitab');
    expect(ids).not.toContain('creditel');
    expect(tarjetasAceptadas([])).toEqual([]);
  });

  it('solo imágenes por HTTPS (si no, el nombre)', () => {
    expect(
      tarjetasAceptadas(RESPUESTA_MP).find((t) => t.id === 'lider')?.imagen,
    ).toBeNull();
  });

  it('una marca que solo es de débito usa el nombre sin «Débito»', () => {
    expect(
      tarjetasAceptadas([medio('debcabal', 'Cabal Débito', 'debit_card')]),
    ).toEqual([
      {
        id: 'cabal',
        nombre: 'Cabal',
        imagen: img('debcabal'),
        credito: false,
        debito: true,
      },
    ]);
  });

  it('el id de la marca sale del medio de pago', () => {
    expect(marcaDelMedio('debvisa')).toBe('visa');
    expect(marcaDelMedio('DebMaster')).toBe('master');
    expect(marcaDelMedio('oca')).toBe('oca');
    expect(marcaDelMedio('deb')).toBe('deb');
  });
});

describe('TarjetasAceptadasService', () => {
  const entorno = process.env;
  let fetchMock: jest.SpyInstance;

  const respuesta = (cuerpo: unknown, ok = true, status = 200) =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(cuerpo),
    } as Response);

  beforeEach(() => {
    process.env = {
      ...entorno,
      MP_ACCESS_TOKEN: 'TEST-token',
      MP_API_BASE_URL: 'https://mp.test/',
    };
    fetchMock = jest.spyOn(global, 'fetch');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    process.env = entorno;
    jest.restoreAllMocks();
  });

  it('pide la lista una vez con el token y la guarda 6 horas', async () => {
    fetchMock.mockReturnValue(respuesta(RESPUESTA_MP));
    const servicio = new TarjetasAceptadasService();

    const lista = await servicio.obtener(0);
    expect(lista.map((t) => t.id)).toContain('visa');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mp.test/v1/payment_methods',
      expect.objectContaining({
        headers: { Authorization: 'Bearer TEST-token' },
      }),
    );

    await servicio.obtener(VIGENCIA_TARJETAS_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await servicio.obtener(VIGENCIA_TARJETAS_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('muchos pedidos a la vez: una sola consulta a Mercado Pago', async () => {
    fetchMock.mockReturnValue(respuesta(RESPUESTA_MP));
    const servicio = new TarjetasAceptadasService();
    await Promise.all([servicio.obtener(0), servicio.obtener(0)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('si Mercado Pago falla, devuelve la última lista buena y reintenta a los 5 minutos', async () => {
    fetchMock.mockReturnValueOnce(respuesta(RESPUESTA_MP));
    const servicio = new TarjetasAceptadasService();
    const buena = await servicio.obtener(0);

    fetchMock.mockReturnValueOnce(respuesta({}, false, 500));
    await expect(servicio.obtener(VIGENCIA_TARJETAS_MS)).resolves.toEqual(
      buena,
    );
    expect(Logger.prototype.warn).toHaveBeenCalled();
    await servicio.obtener(VIGENCIA_TARJETAS_MS + REINTENTO_TARJETAS_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockRejectedValueOnce(new Error('sin red'));
    await expect(
      servicio.obtener(VIGENCIA_TARJETAS_MS + REINTENTO_TARJETAS_MS),
    ).resolves.toEqual(buena);
  });

  it('una respuesta que no es una lista, o sin token: lista vacía, sin lanzar', async () => {
    fetchMock.mockReturnValue(respuesta({ error: 'x' }));
    await expect(new TarjetasAceptadasService().obtener(0)).resolves.toEqual(
      [],
    );

    delete process.env.MP_ACCESS_TOKEN;
    fetchMock.mockClear();
    await expect(new TarjetasAceptadasService().obtener(0)).resolves.toEqual(
      [],
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('el controlador devuelve { tarjetas }', async () => {
    const servicio = { obtener: jest.fn().mockResolvedValue([]) };
    await expect(
      new TarjetasAceptadasController(servicio as never).listar(),
    ).resolves.toEqual({ tarjetas: [] });
  });

  it('sin MP_API_BASE_URL usa la API real', async () => {
    delete process.env.MP_API_BASE_URL;
    fetchMock.mockReturnValue(respuesta([]));
    await new TarjetasAceptadasService().obtener(0);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.mercadopago.com/v1/payment_methods',
    );
  });
});
