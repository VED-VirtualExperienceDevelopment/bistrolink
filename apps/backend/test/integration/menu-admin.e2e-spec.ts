import 'dotenv/config';

// ── 1. MOCKS DE VARIABLES DE ENTORNO (Obligatorio para que AppModule inicie) ──
process.env.MP_ACCESS_TOKEN =
  process.env.MP_ACCESS_TOKEN || 'TEST_MP_ACCESS_TOKEN';
process.env.MP_PUBLIC_KEY = process.env.MP_PUBLIC_KEY || 'TEST_MP_PUBLIC_KEY';
process.env.PLEXO_API_KEY = process.env.PLEXO_API_KEY || 'TEST_PLEXO_API_KEY';
process.env.PLEXO_ENDPOINT =
  process.env.PLEXO_ENDPOINT || 'https://api.test.plexo.com.uy';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { MenuAdminService } from '../../src/menu/menu-admin.service';
import { MenuGateway } from '../../src/menu/menu.gateway';

// ── 2. CONFIG DE KEYCLOAK (Patrón oficial del repo para e2e) ──
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? 'admin-test';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const COCINA_USER = process.env.TEST_COCINA_USERNAME;
const COCINA_PASS = process.env.TEST_COCINA_PASSWORD;

async function getToken(username: string, password: string): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        username,
        password,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `No se pudo obtener token para ${username}: ${res.status} ${await res.text()}`,
    );
  }
  const data = await res.json();
  return data.access_token as string;
}

// Condicionales para saltar tests si no hay fixtures configuradas
const itConAdmin = ADMIN_USER && ADMIN_PASS ? it : it.skip;
const itConCocina = COCINA_USER && COCINA_PASS ? it : it.skip;

const CATEGORIA_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';

// ── 3. MOCKS DE SERVICIOS (Para tests sin dependencias de DB) ──
const mockMenuGateway = {
  emitItemDataUpdated: jest.fn(),
  emitItemUpdated: jest.fn(),
  emitCategoriaUpdated: jest.fn(),
};

const mockMenuAdminService = {
  updateItem: jest.fn().mockImplementation(async (tenantId, itemId, dto) => {
    const updatedItem = {
      id: itemId,
      tenantId,
      ...dto,
      updatedAt: new Date(),
    };

    mockMenuGateway.emitItemDataUpdated(tenantId, {
      itemId,
      data: updatedItem,
    });

    return updatedItem;
  }),
  deleteItem: jest.fn().mockImplementation(async (tenantId, itemId) => {
    const deletedItem = {
      id: itemId,
      tenantId,
      disponible: false,
      nombre: 'Item Eliminado',
      updatedAt: new Date(),
    };

    mockMenuGateway.emitItemUpdated(tenantId, {
      itemId,
      disponible: false,
    });

    return deletedItem;
  }),
  deleteCategoria: jest
    .fn()
    .mockImplementation(async (tenantId, categoriaId) => {
      const deletedCategoria = {
        id: categoriaId,
        tenantId,
        activo: false,
        nombre: 'Categoría Eliminada',
        updatedAt: new Date(),
      };

      mockMenuGateway.emitCategoriaUpdated(tenantId, {
        categoriaId,
        activo: false,
      });

      return deletedCategoria;
    }),
};

describe('Menu Admin (BL-52/BL-53) - CRUD Completo con Soft Delete', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MenuAdminService)
      .useValue(mockMenuAdminService)
      .overrideProvider(MenuGateway)
      .useValue(mockMenuGateway)
      .compile();

    app = moduleRef.createNestApplication();

    // Replicar el ValidationPipe de main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    await app.listen(0);
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  }, 30000);

  describe('Validación de DTOs (400 Bad Request)', () => {
    itConAdmin(
      '[TC-E-001] POST /admin/menu/item: devuelve 400 si el nombre está vacío',
      async () => {
        const token = await getToken(
          ADMIN_USER as string,
          ADMIN_PASS as string,
        );

        await request(app.getHttpServer())
          .post('/admin/menu/item')
          .set('Authorization', `Bearer ${token}`)
          .send({
            categoriaId: CATEGORIA_ID,
            nombre: '',
            precio: '10.50',
          })
          .expect(HttpStatus.BAD_REQUEST)
          .expect((res) => {
            expect(res.body.message).toEqual(
              expect.arrayContaining([
                expect.stringContaining('El nombre no puede estar vacío'),
              ]),
            );
          });
      },
    );

    itConAdmin(
      '[TC-E-002] POST /admin/menu/item: devuelve 400 si el precio es negativo',
      async () => {
        const token = await getToken(
          ADMIN_USER as string,
          ADMIN_PASS as string,
        );

        await request(app.getHttpServer())
          .post('/admin/menu/item')
          .set('Authorization', `Bearer ${token}`)
          .send({
            categoriaId: CATEGORIA_ID,
            nombre: 'Hamburguesa',
            precio: '-5.00',
          })
          .expect(HttpStatus.BAD_REQUEST)
          .expect((res) => {
            expect(res.body.message).toEqual(
              expect.arrayContaining([
                expect.stringContaining(
                  'El precio debe ser un número positivo válido',
                ),
              ]),
            );
          });
      },
    );

    itConAdmin(
      '[TC-E-003] PATCH /admin/menu/item/:id: devuelve 400 si el precio es negativo',
      async () => {
        const token = await getToken(
          ADMIN_USER as string,
          ADMIN_PASS as string,
        );

        await request(app.getHttpServer())
          .patch(`/admin/menu/item/${ITEM_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            precio: '-10.00',
          })
          .expect(HttpStatus.BAD_REQUEST)
          .expect((res) => {
            expect(res.body.message).toEqual(
              expect.arrayContaining([
                expect.stringContaining(
                  'El precio debe ser un número positivo válido',
                ),
              ]),
            );
          });
      },
    );
  });

  describe('Autorización por Rol (403 Forbidden)', () => {
    itConCocina(
      '[TC-E-004] POST /admin/menu/item: devuelve 403 si el rol es COCINA',
      async () => {
        const token = await getToken(
          COCINA_USER as string,
          COCINA_PASS as string,
        );

        await request(app.getHttpServer())
          .post('/admin/menu/item')
          .set('Authorization', `Bearer ${token}`)
          .send({
            categoriaId: CATEGORIA_ID,
            nombre: 'Pizza',
            precio: '15.00',
          })
          .expect(HttpStatus.FORBIDDEN);
      },
    );

    itConCocina(
      '[TC-E-005] PATCH /admin/menu/item/:id: devuelve 403 si el rol es COCINA',
      async () => {
        const token = await getToken(
          COCINA_USER as string,
          COCINA_PASS as string,
        );

        await request(app.getHttpServer())
          .patch(`/admin/menu/item/${ITEM_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            nombre: 'Pizza Actualizada',
          })
          .expect(HttpStatus.FORBIDDEN);
      },
    );

    itConCocina(
      '[TC-E-009] DELETE /admin/menu/item/:id: devuelve 403 si el rol es COCINA',
      async () => {
        const token = await getToken(
          COCINA_USER as string,
          COCINA_PASS as string,
        );

        await request(app.getHttpServer())
          .delete(`/admin/menu/item/${ITEM_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(HttpStatus.FORBIDDEN);
      },
    );

    itConCocina(
      '[TC-E-011] DELETE /admin/menu/categoria/:id: devuelve 403 si el rol es COCINA',
      async () => {
        const token = await getToken(
          COCINA_USER as string,
          COCINA_PASS as string,
        );

        await request(app.getHttpServer())
          .delete(`/admin/menu/categoria/${CATEGORIA_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(HttpStatus.FORBIDDEN);
      },
    );
  });

  describe('Soft Delete de Ítems (DELETE)', () => {
    itConAdmin(
      '[TC-E-007] DELETE /admin/menu/item/:id: elimina lógicamente un ítem (200)',
      async () => {
        const token = await getToken(
          ADMIN_USER as string,
          ADMIN_PASS as string,
        );

        // Limpiar mocks
        mockMenuGateway.emitItemUpdated.mockClear();
        mockMenuGateway.emitItemDataUpdated.mockClear();

        const inicio = Date.now();
        const res = await request(app.getHttpServer())
          .delete(`/admin/menu/item/${ITEM_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(HttpStatus.OK);

        const duracionMs = Date.now() - inicio;

        expect(res.status).toBe(200);
        expect(res.body.disponible).toBe(false);
        expect(duracionMs).toBeLessThan(2000);

        // Verificar que se emitió el evento WebSocket
        expect(mockMenuGateway.emitItemUpdated).toHaveBeenCalledWith(
          expect.any(String),
          { itemId: ITEM_ID, disponible: false },
        );
      },
    );
  });

  describe('Soft Delete de Categorías (DELETE)', () => {
    itConAdmin(
      '[TC-E-010] DELETE /admin/menu/categoria/:id: elimina lógicamente una categoría (200)',
      async () => {
        const token = await getToken(
          ADMIN_USER as string,
          ADMIN_PASS as string,
        );

        // Limpiar mocks
        mockMenuGateway.emitCategoriaUpdated.mockClear();

        const inicio = Date.now();
        const res = await request(app.getHttpServer())
          .delete(`/admin/menu/categoria/${CATEGORIA_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(HttpStatus.OK);

        const duracionMs = Date.now() - inicio;

        expect(res.status).toBe(200);
        expect(res.body.activo).toBe(false);
        expect(duracionMs).toBeLessThan(2000);

        // Verificar que se emitió el evento WebSocket
        expect(mockMenuGateway.emitCategoriaUpdated).toHaveBeenCalledWith(
          expect.any(String),
          { categoriaId: CATEGORIA_ID, activo: false },
        );
      },
    );
  });

  describe('Integración WebSocket - Tiempo Real (<2s)', () => {
    itConAdmin(
      '[TC-E-006] PATCH /admin/menu/item/:id: emite evento WebSocket en menos de 2s',
      async () => {
        const token = await getToken(
          ADMIN_USER as string,
          ADMIN_PASS as string,
        );

        // Limpiar el mock antes del test
        mockMenuGateway.emitItemDataUpdated.mockClear();

        const inicio = Date.now();

        // Hacer el PATCH request
        const res = await request(app.getHttpServer())
          .patch(`/admin/menu/item/${ITEM_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            nombre: 'Pizza Actualizada',
          });

        const duracionMs = Date.now() - inicio;

        // Verificar que el request fue exitoso
        expect(res.status).toBe(200);

        // Verificar que el gateway fue llamado con los parámetros correctos
        expect(mockMenuGateway.emitItemDataUpdated).toHaveBeenCalledTimes(1);

        expect(mockMenuGateway.emitItemDataUpdated).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            itemId: ITEM_ID,
            data: expect.objectContaining({
              nombre: 'Pizza Actualizada',
            }),
          }),
        );

        // Verificar que se completó en menos de 2 segundos
        expect(duracionMs).toBeLessThan(2000);

        console.log(`⏱️ Tiempo de emisión WebSocket: ${duracionMs}ms`);
      },
      10000,
    );
  });
});
