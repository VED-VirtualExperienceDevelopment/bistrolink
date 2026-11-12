import type { NextFunction, Request, Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import {
  decidirRedireccionHttps,
  esRutaDocs,
  headersDeSeguridad,
  origenesPermitidos,
  PERMISSIONS_POLICY,
  redireccionHttps,
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

describe('decidirRedireccionHttps: casos borde (BL-426)', () => {
  const env = {
    RAILWAY_PUBLIC_DOMAIN: 'bistrolink-api-staging.up.railway.app',
  };

  it('[TC-U-116] varias barras finales en FRONTEND_URL se quitan todas', () => {
    expect(
      origenesPermitidos({ FRONTEND_URL: ' https://web.ejemplo.uy/// ' }),
    ).toEqual(['https://web.ejemplo.uy']);
  });

  it('[TC-U-116] FRONTEND_URL vacía usa el frontend local', () => {
    expect(origenesPermitidos({ FRONTEND_URL: '   ' })).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('[TC-U-116] por HTTP sin header Host se rechaza', () => {
    expect(decidirRedireccionHttps('http', undefined, '/', env)).toEqual({
      tipo: 'rechazar',
    });
  });

  it('[TC-U-116] una ruta sin barra inicial se completa con una', () => {
    expect(
      decidirRedireccionHttps(
        'http',
        'bistrolink-api-staging.up.railway.app',
        'health',
        env,
      ),
    ).toEqual({
      tipo: 'redirigir',
      url: 'https://bistrolink-api-staging.up.railway.app/health',
    });
  });
});

describe('redireccionHttps: middleware (BL-426)', () => {
  const env = {
    RAILWAY_PUBLIC_DOMAIN: 'bistrolink-api-staging.up.railway.app',
  };

  function pedido(headers: Record<string, string>, originalUrl = '/menu') {
    return {
      header: (nombre: string) => headers[nombre.toLowerCase()],
      originalUrl,
    } as unknown as Request;
  }

  function respuesta() {
    const res = {
      redirect: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
  }

  it('[TC-U-117] por HTTPS deja pasar el pedido', () => {
    const res = respuesta();
    const next = jest.fn() as NextFunction;

    redireccionHttps(env)(
      pedido({ 'x-forwarded-proto': 'https' }),
      res as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('[TC-U-117] por HTTP con el Host de la API redirige con 301', () => {
    const res = respuesta();
    const next = jest.fn() as NextFunction;

    redireccionHttps(env)(
      pedido({
        'x-forwarded-proto': 'http',
        host: 'bistrolink-api-staging.up.railway.app',
      }),
      res as unknown as Response,
      next,
    );

    expect(res.redirect).toHaveBeenCalledWith(
      301,
      'https://bistrolink-api-staging.up.railway.app/menu',
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('[TC-U-117] por HTTP con otro Host responde 400 y no redirige', () => {
    const res = respuesta();
    const next = jest.fn() as NextFunction;

    redireccionHttps(env)(
      pedido({ 'x-forwarded-proto': 'http', host: 'sitio-malicioso.com' }),
      res as unknown as Response,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Host no permitido',
    });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('valores por defecto: process.env (BL-426)', () => {
  it('[TC-U-118] sin argumentos usa process.env', () => {
    const next = jest.fn() as NextFunction;
    expect(Array.isArray(origenesPermitidos())).toBe(true);
    expect(decidirRedireccionHttps(undefined, undefined, '/')).toEqual({
      tipo: 'seguir',
    });
    redireccionHttps()(
      { header: () => undefined, originalUrl: '/' } as unknown as Request,
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

/**
 * BL-526: headers de seguridad de la API según el baseline de OWASP ZAP.
 * Se prueban sobre una app de Express mínima, con las mismas rutas que
 * importan: una respuesta JSON y la documentación interactiva.
 */
describe('headersDeSeguridad (BL-526)', () => {
  const app = express();
  app.use(headersDeSeguridad());
  app.get('/', (_req, res) => {
    res.json({ servicio: 'bistrolink-api', estado: 'ok' });
  });
  app.get('/api/docs', (_req, res) => {
    res.type('html').send('<html></html>');
  });
  app.get('/api/docs-json', (_req, res) => {
    res.json({});
  });

  it('[TC-U-479] la API responde con una CSP para JSON, sin comodín ni unsafe-inline', async () => {
    const respuesta = await request(app).get('/').expect(200);
    const csp = respuesta.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('https:');
    expect(csp).not.toContain('unsafe-inline');
  });

  it('[TC-U-480] manda Permissions-Policy y COEP, y mantiene los headers de helmet', async () => {
    const respuesta = await request(app).get('/').expect(200);
    expect(respuesta.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
    expect(respuesta.headers['cross-origin-embedder-policy']).toBe(
      'require-corp',
    );
    expect(respuesta.headers['strict-transport-security']).toBeDefined();
    expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
    expect(respuesta.headers['cross-origin-resource-policy']).toBe(
      'same-origin',
    );
    expect(respuesta.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(respuesta.headers['x-powered-by']).toBeUndefined();
  });

  it('[TC-U-481] Swagger UI tiene su propia CSP, del mismo origen y sin comodín', async () => {
    const respuesta = await request(app).get('/api/docs').expect(200);
    const csp = respuesta.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('https:');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(respuesta.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
  });

  it('[TC-U-482] el contrato en JSON (/api/docs-json) lleva la CSP de la API', async () => {
    const respuesta = await request(app).get('/api/docs-json').expect(200);
    expect(respuesta.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
  });

  it('[TC-U-482] esRutaDocs reconoce la documentación y lo que cuelga de ella', () => {
    expect(esRutaDocs('/api/docs')).toBe(true);
    expect(esRutaDocs('/api/docs/swagger-ui.css')).toBe(true);
    expect(esRutaDocs('/api/docs-json')).toBe(false);
    expect(esRutaDocs('/api/documentos')).toBe(false);
    expect(esRutaDocs('/')).toBe(false);
  });
});
