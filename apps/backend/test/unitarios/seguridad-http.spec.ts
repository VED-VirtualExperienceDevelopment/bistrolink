import {
  decidirRedireccionHttps,
  origenesPermitidos,
} from '../../src/seguridad-http';

/** BL-426: CORS limitado al frontend y redirección HTTPS sin usar el Host del cliente. */

describe('origenesPermitidos (BL-426)', () => {
  it('[TC-U-112] usa FRONTEND_URL, sin barra final', () => {
    expect(
      origenesPermitidos({
        FRONTEND_URL: 'https://bistrolink-web-staging.up.railway.app/',
      }),
    ).toEqual(['https://bistrolink-web-staging.up.railway.app']);
  });

  it('[TC-U-112] sin FRONTEND_URL usa el frontend local', () => {
    expect(origenesPermitidos({})).toEqual(['http://localhost:3000']);
  });

  it('[TC-U-113] suma CORS_ORIGENES_EXTRA, sin repetir ni dejar vacíos', () => {
    expect(
      origenesPermitidos({
        FRONTEND_URL: 'https://web.ejemplo.uy',
        CORS_ORIGENES_EXTRA:
          ' https://otro.ejemplo.uy/ ,,https://web.ejemplo.uy',
      }),
    ).toEqual(['https://web.ejemplo.uy', 'https://otro.ejemplo.uy']);
  });

  it('[TC-U-113] nunca incluye el comodín', () => {
    expect(
      origenesPermitidos({ FRONTEND_URL: 'https://web.ejemplo.uy' }),
    ).not.toContain('*');
  });
});

describe('decidirRedireccionHttps (BL-426)', () => {
  const env = {
    RAILWAY_PUBLIC_DOMAIN: 'bistrolink-api-staging.up.railway.app',
  };

  it.each([undefined, 'https', 'HTTPS', 'https, http'])(
    '[TC-U-114] con x-forwarded-proto %p no redirige',
    (proto) => {
      expect(
        decidirRedireccionHttps(proto, 'cualquiera.com', '/health', env),
      ).toEqual({ tipo: 'seguir' });
    },
  );

  it('[TC-U-114] por HTTP con el Host de la API redirige a su dominio', () => {
    expect(
      decidirRedireccionHttps(
        'http',
        'BistroLink-API-Staging.up.railway.app',
        '/menu?mesa=1',
        env,
      ),
    ).toEqual({
      tipo: 'redirigir',
      url: 'https://bistrolink-api-staging.up.railway.app/menu?mesa=1',
    });
  });

  it('[TC-U-115] por HTTP con otro Host se rechaza (no redirige a ese sitio)', () => {
    expect(
      decidirRedireccionHttps('http', 'sitio-malicioso.com', '/login', env),
    ).toEqual({ tipo: 'rechazar' });
  });

  it('[TC-U-115] una ruta que empieza con // sigue yendo al dominio de la API', () => {
    expect(
      decidirRedireccionHttps(
        'http',
        'bistrolink-api-staging.up.railway.app',
        '//sitio-malicioso.com',
        env,
      ),
    ).toEqual({
      tipo: 'redirigir',
      url: 'https://bistrolink-api-staging.up.railway.app//sitio-malicioso.com',
    });
  });

  it('[TC-U-115] API_PUBLIC_HOST tiene prioridad sobre RAILWAY_PUBLIC_DOMAIN', () => {
    expect(
      decidirRedireccionHttps('http', 'api.ejemplo.uy', '/', {
        ...env,
        API_PUBLIC_HOST: 'api.ejemplo.uy',
      }),
    ).toEqual({ tipo: 'redirigir', url: 'https://api.ejemplo.uy/' });
  });

  it('[TC-U-115] sin dominio configurado, un pedido por HTTP se rechaza', () => {
    expect(decidirRedireccionHttps('http', 'x.com', '/', {})).toEqual({
      tipo: 'rechazar',
    });
  });
});
