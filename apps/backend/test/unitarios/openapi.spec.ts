import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../../src/app.module';
import {
  crearDocumentoOpenApi,
  openApiHabilitado,
  SEGURIDAD_KEYCLOAK,
  SEGURIDAD_MESA_QR,
  SEGURIDAD_PEDIDO,
} from '../../src/openapi';

// BL-211 (Línea de Base §3.3.2): el contrato OpenAPI 3 se genera desde los
// controladores y DTOs. Este test corre en el job de tests unitarios: si el
// contrato no se puede generar, el pipeline falla.
//
// La app se crea en modo preview: arma el grafo de módulos sin instanciar
// servicios (sin base de datos ni Keycloak), que es todo lo que necesita
// SwaggerModule. Los DTOs se describen con el plugin de @nestjs/swagger,
// aplicado a ts-jest en test/openapi/swagger-plugin.transformer.js.

describe('contrato OpenAPI (BL-211)', () => {
  let app: INestApplication;
  let documento: OpenAPIObject;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { preview: true, logger: false });
    documento = crearDocumentoOpenApi(app);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('es OpenAPI 3', () => {
    expect(documento.openapi).toMatch(/^3\./);
    expect(documento.info.title).toBe('BistroLink API');
  });

  it.each([
    ['/health', 'get'],
    ['/menu/tenant/{tenantId}/restaurante/{restauranteId}', 'get'],
    ['/pedidos', 'post'],
    ['/pedidos/{pedidoId}/pagos', 'post'],
    ['/mesas/layout', 'get'],
    ['/usuarios', 'get'],
    ['/admin/menu/item', 'post'],
    ['/webhooks/mercadopago', 'post'],
  ])('incluye %s (%s)', (ruta, metodo) => {
    expect(documento.paths[ruta]).toBeDefined();
    expect(
      (documento.paths[ruta] as Record<string, unknown>)[metodo],
    ).toBeDefined();
  });

  it('deja afuera los endpoints de prueba (/test)', () => {
    expect(
      Object.keys(documento.paths).filter((r) => r.startsWith('/test')),
    ).toEqual([]);
  });

  it('declara el JWT de Keycloak y los headers de acceso del comensal', () => {
    const esquemas = documento.components?.securitySchemes ?? {};
    expect(esquemas[SEGURIDAD_KEYCLOAK]).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(esquemas[SEGURIDAD_MESA_QR]).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-Mesa-Token',
    });
    expect(esquemas[SEGURIDAD_PEDIDO]).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-Pedido-Token',
    });
  });

  it('las rutas del personal piden el JWT; el menú público no', () => {
    expect(documento.paths['/usuarios'].get?.security).toEqual(
      expect.arrayContaining([{ [SEGURIDAD_KEYCLOAK]: [] }]),
    );
    expect(
      documento.paths['/menu/tenant/{tenantId}/restaurante/{restauranteId}'].get
        ?.security,
    ).toBeUndefined();
  });

  it('el pago pide el JWT junto con el QR de la mesa o el token del pedido', () => {
    expect(documento.paths['/pedidos/{pedidoId}/pagos'].post?.security).toEqual(
      expect.arrayContaining([
        { [SEGURIDAD_KEYCLOAK]: [], [SEGURIDAD_MESA_QR]: [] },
        { [SEGURIDAD_KEYCLOAK]: [], [SEGURIDAD_PEDIDO]: [] },
      ]),
    );
  });

  it('describe los DTOs a partir de sus tipos y validaciones (plugin)', () => {
    const esquemas = documento.components?.schemas ?? {};
    const crearPedido = esquemas.CrearPedidoDto as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(crearPedido?.properties).toHaveProperty('items');
    expect(crearPedido?.required).toContain('items');
  });
});

describe('openApiHabilitado (BL-211)', () => {
  it.each([
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: 'test' }, true],
    [{}, true],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production', OPENAPI_HABILITADO: 'true' }, true],
    [{ NODE_ENV: 'production', OPENAPI_HABILITADO: ' TRUE ' }, true],
    [{ NODE_ENV: 'development', OPENAPI_HABILITADO: 'false' }, false],
  ])('%j => %s', (env, esperado) => {
    expect(openApiHabilitado(env as NodeJS.ProcessEnv)).toBe(esperado);
  });
});
