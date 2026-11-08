import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

/**
 * BL-211 (Línea de Base §3.3.2): contrato OpenAPI 3 de la API, generado
 * desde los controladores y DTOs. Los DTOs se describen solos gracias al
 * plugin de @nestjs/swagger (nest-cli.json): lee los tipos de TypeScript y
 * los decoradores de class-validator, sin @ApiProperty en cada campo.
 */

/** Ruta de la documentación interactiva (Swagger UI). */
export const RUTA_DOCS = 'api/docs';
/** Ruta del contrato en JSON (la de la UI + "-json", convención de Nest). */
export const RUTA_DOCS_JSON = `${RUTA_DOCS}-json`;

/** Nombres de los esquemas de seguridad, para usar en @ApiBearerAuth etc. */
export const SEGURIDAD_KEYCLOAK = 'keycloak';
export const SEGURIDAD_MESA_QR = 'mesa-qr';
export const SEGURIDAD_PEDIDO = 'pedido-token';

/**
 * Se publica en local y en staging; en producción queda apagado salvo que
 * se pida explícitamente. Staging y producción corren con
 * NODE_ENV=production (misma imagen), así que staging lo prende con
 * OPENAPI_HABILITADO=true.
 */
export function openApiHabilitado(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env.OPENAPI_HABILITADO?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return env.NODE_ENV !== 'production';
}

export function crearDocumentoOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('BistroLink API')
    .setDescription(
      'API de BistroLink (SaaS multi-tenant para restaurantes). ' +
        'El tenant sale siempre del token, nunca del cliente.',
    )
    .setVersion(process.env.APP_VERSION ?? process.env.GIT_SHA ?? 'dev')
    // Personal (ADMIN, MOZO, COCINA) y comensal técnico: JWT de Keycloak.
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token de Keycloak (realm bistrolink).',
      },
      SEGURIDAD_KEYCLOAK,
    )
    // HU-034 (BL-204): la mesa se identifica con el token de su QR.
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Mesa-Token',
        description: 'Token del QR de la mesa (pedidos, pagos y llamados).',
      },
      SEGURIDAD_MESA_QR,
    )
    // BL-311 (RD.05): pedido para retirar, token que devuelve POST /pedidos.
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Pedido-Token',
        description: 'Token de acceso de un pedido para retirar.',
      },
      SEGURIDAD_PEDIDO,
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, metodo) =>
      `${controller.replace(/Controller$/, '')}_${metodo}`,
  });
}

/** Publica /api/docs y /api/docs-json si corresponde al entorno. */
export function configurarOpenApi(app: INestApplication): boolean {
  if (!openApiHabilitado()) return false;
  const documento = crearDocumentoOpenApi(app);
  SwaggerModule.setup(RUTA_DOCS, app, documento, {
    jsonDocumentUrl: RUTA_DOCS_JSON,
    swaggerOptions: { persistAuthorization: false },
  });
  return true;
}
