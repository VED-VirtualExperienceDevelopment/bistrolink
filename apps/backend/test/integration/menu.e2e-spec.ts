import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { Prisma, PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { QrMesaTokenService } from '../../src/qr-mesa/qr-mesa-token.service';
import { asegurarClaveQr, tokenQrDeMesa } from './support/qr-mesa';

// Fixtures propios, aislados de los del seed de desarrollo
// (prisma/seed.ts) — así este test no depende de que alguien haya corrido
// `prisma db seed` antes, y no se rompe si esos datos cambian.
// Se crean en beforeAll y se borran en afterAll: el test no deja datos en
// la base.
const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const RESTAURANTE_A = 'aaaaaaaa-0000-0000-0000-000000000011';
const RESTAURANTE_B = 'bbbbbbbb-0000-0000-0000-000000000022';
const MESA_A = 'aaaaaaaa-0000-0000-0000-000000000111';
const MESA_B = 'bbbbbbbb-0000-0000-0000-000000000222';

// RUT propio de cada tenant de prueba: tenant.rut es único (BL-163).
const RUT_A = '210000000101';
const RUT_B = '210000000102';

const prisma = new PrismaClient();

// Fija app.tenant_id dentro de la transacción, igual que TenantPrismaService,
// para que las escrituras y los borrados pasen las políticas RLS si la
// conexión del test no es superusuario.
async function enTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

async function seedTenant(
  tenantId: string,
  restauranteId: string,
  mesaId: string,
  nombre: string,
  rut: string,
) {
  // `update: { rut }` corrige bases donde estos tenants quedaron de corridas
  // anteriores con el RUT que tenía antes el tenant A del seed (210000000019).
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: { rut },
    create: {
      id: tenantId,
      razonSocial: nombre,
      rut,
      plan: 'BASICO',
    },
  });

  await enTenant(tenantId, async (tx) => {
    await tx.restaurante.upsert({
      where: { id: restauranteId },
      update: {},
      create: {
        id: restauranteId,
        tenantId,
        nombre,
        direccion: 'Dirección de prueba',
        timezone: 'America/Montevideo',
      },
    });

    await tx.mesa.upsert({
      where: { id: mesaId },
      update: {},
      create: {
        id: mesaId,
        tenantId,
        restauranteId,
        numero: 99,
        estado: 'LIBRE',
      },
    });
  });
}

// Borra todo lo que creó seedTenant, en el orden que exigen las claves
// foráneas: mesa → restaurante → tenant. Filtra por los ids fijos de este
// archivo, así nunca toca datos de otros tests ni del seed.
async function borrarTenant(
  tenantId: string,
  restauranteId: string,
  mesaId: string,
) {
  await enTenant(tenantId, async (tx) => {
    await tx.mesa.deleteMany({ where: { id: mesaId, tenantId } });
    await tx.restaurante.deleteMany({ where: { id: restauranteId, tenantId } });
  });
  // tenant no tiene RLS (es la raíz del aislamiento).
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

// HU-034 (BL-204): el menú de la mesa se pide con el token opaco del QR
// (GET /menu/qr/:token). La ruta vieja por ids (GET /menu/:tenantId/:mesaId)
// se retiró: con los ids en la URL, cualquiera podía armar el enlace de otra
// mesa.
describe('Menú (HU-001 / HU-034) - QR de mesa y aislamiento multi-tenant - integración', () => {
  let app: INestApplication;

  beforeAll(async () => {
    asegurarClaveQr();
    await seedTenant(
      TENANT_A,
      RESTAURANTE_A,
      MESA_A,
      'Restaurante Test A',
      RUT_A,
    );
    await seedTenant(
      TENANT_B,
      RESTAURANTE_B,
      MESA_B,
      'Restaurante Test B',
      RUT_B,
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    try {
      await borrarTenant(TENANT_A, RESTAURANTE_A, MESA_A);
      await borrarTenant(TENANT_B, RESTAURANTE_B, MESA_B);

      // Si el borrado no pudo con todo, la suite lo reporta en vez de dejar
      // datos en la base en silencio.
      const restantes = await prisma.tenant.count({
        where: { id: { in: [TENANT_A, TENANT_B] } },
      });
      expect(restantes).toBe(0);
    } finally {
      await app?.close();
      await prisma.$disconnect();
    }
  });

  it('[TC-I-010] Menú: devuelve el menú y el número de la mesa del QR', async () => {
    const qrToken = await tokenQrDeMesa(app, TENANT_A, MESA_A);

    const res = await request(app.getHttpServer())
      .get(`/menu/qr/${qrToken}`)
      .expect(200);

    expect(res.body.restaurante.nombre).toBe('Restaurante Test A');
    expect(res.body.mesa).toEqual({ numero: 99 });
  });

  it('[TC-I-011] Menú: devuelve 404 si el QR combina un tenant con una mesa de OTRO tenant', async () => {
    // Caso crítico: el token está bien cifrado (misma clave) pero junta el
    // tenant A con una mesa real del tenant B. El endpoint es público a
    // propósito (sin JWT); si este test pasara con 200, sería una fuga de
    // datos real entre tenants.
    const qrToken = app.get(QrMesaTokenService).cifrar({
      tenantId: TENANT_A,
      mesaId: MESA_B,
      version: 1,
    });

    await request(app.getHttpServer()).get(`/menu/qr/${qrToken}`).expect(404);
  });

  it('[TC-I-012] Menú: devuelve 404 para el QR de una mesa inexistente', async () => {
    const qrToken = app.get(QrMesaTokenService).cifrar({
      tenantId: TENANT_A,
      mesaId: '00000000-0000-0000-0000-000000000000',
      version: 1,
    });

    await request(app.getHttpServer()).get(`/menu/qr/${qrToken}`).expect(404);
  });

  it('[TC-I-013] Menú: devuelve 404 si el token no es un QR emitido por el backend', async () => {
    await request(app.getHttpServer())
      .get('/menu/qr/EsteTokenNoLoEmitioElBackend')
      .expect(404);
  });

  it('[TC-I-055] Menú: devuelve 410 si el QR de la mesa se regeneró', async () => {
    const qrViejo = await tokenQrDeMesa(app, TENANT_A, MESA_A);
    // Mismo efecto que POST /mesas/:id/qr/regenerar: sube la versión.
    await enTenant(TENANT_A, (tx) =>
      tx.mesa.update({
        where: { id: MESA_A },
        data: { qrVersion: { increment: 1 } },
      }),
    );

    await request(app.getHttpServer()).get(`/menu/qr/${qrViejo}`).expect(410);

    const qrNuevo = await tokenQrDeMesa(app, TENANT_A, MESA_A);
    await request(app.getHttpServer()).get(`/menu/qr/${qrNuevo}`).expect(200);
  });

  it('[TC-I-056] Menú: la ruta vieja por ids ya no existe (404)', async () => {
    await request(app.getHttpServer())
      .get(`/menu/${TENANT_A}/${MESA_A}`)
      .expect(404);
  });
});
