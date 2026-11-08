import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { MenuAdminService } from '../../src/menu/menu-admin.service';
import { conPagoFalso } from './support/pago-falso';

// HU-035 (BL-205): registro de auditoría de acciones administrativas.
//
// Usa el ítem del seed del tenant A y le devuelve el precio original al
// terminar. Los tests por HTTP necesitan los usuarios de prueba de Keycloak
// (TEST_ADMIN_* y TEST_MOZO_*); sin ellos se saltean.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const ACTOR_PRUEBA = 'script:test-bl-205';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;
const itConAdminYMozo =
  ADMIN_USER && ADMIN_PASS && MOZO_USER && MOZO_PASS ? it : it.skip;

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
    throw new Error(`No se pudo obtener token para ${username}: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

describe('HU-035 (BL-205): registro de auditoría', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let menuAdmin: MenuAdminService;
  let precioOriginal: string;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
    tenantId = TENANT_ID,
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  const registrosDelItem = (accion: string) =>
    enTenant<
      {
        id: string;
        actorKeycloakId: string;
        valoresAntes: unknown;
        valoresDespues: unknown;
      }[]
    >((tx) =>
      tx.registroAuditoria.findMany({
        where: { accion, entidadId: ITEM_ID },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          actorKeycloakId: true,
          valoresAntes: true,
          valoresDespues: true,
        },
      }),
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    tenantPrisma = await app.resolve(TenantPrismaService);
    menuAdmin = await app.resolve(MenuAdminService);

    const item = await enTenant<{ precio: { toFixed: (n: number) => string } }>(
      (tx) =>
        tx.itemCarta.findUniqueOrThrow({
          where: { id: ITEM_ID },
          select: { precio: true },
        }),
    );
    precioOriginal = item.precio.toFixed(2);
  }, 30000);

  afterAll(async () => {
    await enTenant((tx) =>
      tx.itemCarta.update({
        where: { id: ITEM_ID },
        data: { precio: precioOriginal },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-109] HU-035: un cambio de precio de la carta queda registrado con el valor antes y después', async () => {
    const precioNuevo = (Number(precioOriginal) + 1).toFixed(2);

    await menuAdmin.updateItem(
      TENANT_ID,
      ITEM_ID,
      { precio: precioNuevo } as never,
      ACTOR_PRUEBA,
    );

    const [registro] = await registrosDelItem('CARTA_ITEM_MODIFICADO');
    expect(registro).toMatchObject({
      actorKeycloakId: ACTOR_PRUEBA,
      valoresAntes: { precio: precioOriginal },
      valoresDespues: { precio: precioNuevo },
    });

    // Volver al precio original también queda registrado.
    await menuAdmin.updateItem(
      TENANT_ID,
      ITEM_ID,
      { precio: precioOriginal } as never,
      ACTOR_PRUEBA,
    );
    const [vuelta] = await registrosDelItem('CARTA_ITEM_MODIFICADO');
    expect(vuelta.valoresDespues).toEqual({ precio: precioOriginal });
  });

  it('[TC-I-110] HU-035: la base rechaza modificar o borrar un registro de auditoría', async () => {
    const [registro] = await registrosDelItem('CARTA_ITEM_MODIFICADO');
    expect(registro).toBeDefined();

    await expect(
      enTenant((tx) =>
        tx.$executeRawUnsafe(
          `UPDATE registro_auditoria SET accion = 'ALTERADO' WHERE id = $1::uuid`,
          registro.id,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      enTenant((tx) =>
        tx.$executeRawUnsafe(
          `DELETE FROM registro_auditoria WHERE id = $1::uuid`,
          registro.id,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    // Sigue igual.
    const sigue = await enTenant<number>((tx) =>
      tx.registroAuditoria.count({
        where: { id: registro.id, accion: 'CARTA_ITEM_MODIFICADO' },
      }),
    );
    expect(sigue).toBe(1);
  });

  it('[TC-I-111] HU-035: desde otro tenant no se ve ningún registro (RLS)', async () => {
    const [registro] = await registrosDelItem('CARTA_ITEM_MODIFICADO');

    const ajenos = await enTenant<number>(
      (tx) => tx.registroAuditoria.count({ where: { id: registro.id } }),
      randomUUID(),
    );

    expect(ajenos).toBe(0);
  });

  itConAdminYMozo(
    '[TC-I-112] HU-035: el administrador consulta el registro filtrado por acción; el mozo recibe 403',
    async () => {
      const tokenAdmin = await getToken(ADMIN_USER!, ADMIN_PASS!);
      const tokenMozo = await getToken(MOZO_USER!, MOZO_PASS!);

      const res = await request(app.getHttpServer())
        .get('/auditoria')
        .query({ accion: 'CARTA_ITEM_MODIFICADO' })
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      expect(res.body.registros.length).toBeGreaterThan(0);
      for (const r of res.body.registros) {
        expect(r.accion).toBe('CARTA_ITEM_MODIFICADO');
      }
      expect(res.body.registros[0]).toMatchObject({
        entidad: 'item_carta',
        entidadId: ITEM_ID,
      });

      await request(app.getHttpServer())
        .get('/auditoria')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .expect(403);
    },
  );
});
