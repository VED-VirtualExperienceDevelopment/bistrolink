/**
 * BL-196: MenuPublicoPage (HU-002, /m/[tenantId]/restaurante/[restauranteId]).
 *
 * La página es un Server Component async: se la llama como función con
 * `params` y se inspecciona el elemento que devuelve, sin renderizar DOM
 * (el config de Jest usa testEnvironment 'node').
 */

// notFound() real lanza una excepción interna de Next; acá se simula con un
// error identificable para poder afirmar que se llamó.
const NOT_FOUND = 'NEXT_HTTP_ERROR_FALLBACK;404';
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  }),
}));

// El componente cliente no se renderiza: alcanza con verificar que la
// página lo devuelve con las props correctas.
jest.mock('@/components/MenuPublico', () => ({
  __esModule: true,
  default: function MenuPublicoMock() {
    return null;
  },
}));

// `cache` de React memoiza por request en RSC; en los tests cada caso tiene
// que hacer su propia llamada a fetch.
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  cache: <T>(fn: T) => fn,
}));

import { notFound } from 'next/navigation';
import MenuPublico from '@/components/MenuPublico';
import MenuPublicoPage, {
  generateMetadata,
} from '@/app/m/[tenantId]/restaurante/[restauranteId]/page';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';

const MENU = {
  restaurante: { nombre: 'Restaurante Testing A' },
  categorias: [],
};

function params() {
  return Promise.resolve({ tenantId: TENANT_ID, restauranteId: RESTAURANTE_ID });
}

function respuesta(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const fetchMock = jest.fn();
let consoleError: jest.SpyInstance;

beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
  (notFound as unknown as jest.Mock).mockClear();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('MenuPublicoPage', () => {
  it('con un restaurante existente devuelve MenuPublico con los datos de la API', async () => {
    fetchMock.mockResolvedValue(respuesta(200, MENU));

    const elemento = await MenuPublicoPage({ params: params() });

    expect(elemento.type).toBe(MenuPublico);
    expect(elemento.props).toEqual({
      restaurante: MENU.restaurante,
      categorias: MENU.categorias,
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`,
      ),
      { cache: 'no-store' },
    );
  });

  it.each([404, 400])(
    'si la API responde %i, llama a notFound() y NO loguea ningún error',
    async (status) => {
      fetchMock.mockResolvedValue(respuesta(status));

      await expect(MenuPublicoPage({ params: params() })).rejects.toThrow(
        NOT_FOUND,
      );
      expect(notFound).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it('si la API responde 500, loguea el error y lo relanza (no es un 404)', async () => {
    fetchMock.mockResolvedValue(respuesta(500));

    await expect(MenuPublicoPage({ params: params() })).rejects.toThrow(
      'Error al cargar el menú público: 500',
    );
    expect(notFound).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Error en MenuPublicoPage:',
      expect.any(Error),
    );
  });

  it('si la API no responde (error de red), loguea el error y lo relanza', async () => {
    const errorDeRed = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(errorDeRed);

    await expect(MenuPublicoPage({ params: params() })).rejects.toBe(errorDeRed);
    expect(notFound).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Error en MenuPublicoPage:',
      errorDeRed,
    );
  });
});

describe('generateMetadata', () => {
  it('usa el nombre del restaurante como título', async () => {
    fetchMock.mockResolvedValue(respuesta(200, MENU));

    await expect(generateMetadata({ params: params() })).resolves.toEqual({
      title: 'Restaurante Testing A',
    });
  });

  it.each([404, 500])('si la API responde %i, el título es «Menú»', async (status) => {
    fetchMock.mockResolvedValue(respuesta(status));

    await expect(generateMetadata({ params: params() })).resolves.toEqual({
      title: 'Menú',
    });
  });
});