import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';

// Fixtures propios, aislados de los del seed de desarrollo
// (prisma/seed.ts) — así este test no depende de que alguien haya corrido
// `prisma db seed` antes, y no se rompe si esos datos cambian.
const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const RESTAURANTE_A = 'aaaaaaaa-0000-0000-0000-000000000011';
const RESTAURANTE_B = 'bbbbbbbb-0000-0000-0000-000000000022';
const MESA_A = 'aaaaaaaa-0000-0000-0000-000000000111';
const MESA_B = 'bbbbbbbb-0000-0000-0000-000000000222';

const prisma = new PrismaClient();

async function seedTenant(
  tenantId: string,
  restauranteId: string,
  mesaId: string,
  nombre: string,
) {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: {
      id: tenantId,
      razonSocial: nombre,
      rut: '210000000019',
      plan: 'BASICO',
    },
  });

  await prisma.$executeRawUnsafe(
    `SELECT set_config('app.tenant_id', $1, false)`,
    tenantId,
  );

  await prisma.restaurante.upsert({
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

  await prisma.mesa.upsert({
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
}

describe('Menú (HU-001) - aislamiento multi-tenant vía RLS - integración', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await seedTenant(TENANT_A, RESTAURANTE_A, MESA_A, 'Restaurante Test A');
    await seedTenant(TENANT_B, RESTAURANTE_B, MESA_B, 'Restaurante Test B');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('[TC-I-010] Menú: devuelve el menú cuando tenantId y mesaId son del mismo tenant', async () => {
    const res = await request(app.getHttpServer())
      .get(`/menu/${TENANT_A}/${MESA_A}`)
      .expect(200);

    expect(res.body.restaurante.nombre).toBe('Restaurante Test A');
  });

  it('[TC-I-011] Menú: devuelve 404 si la mesa pertenece a otro tenant', async () => {
    // Caso crítico: MESA_B es una mesa real, no un UUID inventado. El
    // endpoint de HU-001 es público a propósito (sin JWT) — RLS es la
    // única barrera de aislamiento acá. Si este test alguna vez pasara
    // con 200, sería una fuga de datos real entre tenants.
    await request(app.getHttpServer())
      .get(`/menu/${TENANT_A}/${MESA_B}`)
      .expect(404);
  });

  it('[TC-I-012] Menú: devuelve 404 para una mesa inexistente', async () => {
    await request(app.getHttpServer())
      .get(`/menu/${TENANT_A}/00000000-0000-0000-0000-000000000000`)
      .expect(404);
  });

  it('[TC-I-013] Menú: devuelve 400 si los IDs no son UUIDs válidos', async () => {
    await request(app.getHttpServer())
      .get('/menu/no-es-un-uuid/tampoco-esto')
      .expect(400);
  });
});
