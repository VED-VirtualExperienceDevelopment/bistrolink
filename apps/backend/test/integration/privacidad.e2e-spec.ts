import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { asegurarClaveQr, tokenQrDeMesa } from './support/qr-mesa';

// HU-036 (BL-206): datos del establecimiento para su política de
// privacidad. Endpoint público, como el menú. Todo real (base, RLS).
//
// Cambia el correo de privacidad del restaurante del seed y lo deja como
// estaba al terminar.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_DEMO_ID = '33333333-3333-3333-3333-333333333333';
const CORREO = 'privacidad-bl206@ejemplo.com.uy';

describe('HU-036 (BL-206): datos para la política de privacidad', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let correoOriginal: string | null = null;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);

    correoOriginal = await enTenant<string | null>(async (tx) => {
      const r = await tx.restaurante.findUniqueOrThrow({
        where: { id: RESTAURANTE_ID },
        select: { emailPrivacidad: true },
      });
      await tx.restaurante.update({
        where: { id: RESTAURANTE_ID },
        data: { emailPrivacidad: CORREO },
      });
      return r.emailPrivacidad;
    });
  }, 30000);

  afterAll(async () => {
    await enTenant((tx) =>
      tx.restaurante.update({
        where: { id: RESTAURANTE_ID },
        data: { emailPrivacidad: correoOriginal },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-139] Privacidad: la carta web y el QR devuelven el responsable de los datos y el correo para los derechos; un restaurante ajeno da 404', async () => {
    const porCarta = await request(app.getHttpServer())
      .get(`/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}/privacidad`)
      .expect(200);
    expect(porCarta.body).toEqual({
      establecimiento: {
        nombre: expect.any(String),
        razonSocial: expect.any(String),
        rut: expect.stringMatching(/^\d{12}$/),
        direccion: expect.any(String),
        emailPrivacidad: CORREO,
      },
    });

    const qrToken = await tokenQrDeMesa(app, TENANT_ID, MESA_DEMO_ID);
    const porQr = await request(app.getHttpServer())
      .get(`/menu/qr/${qrToken}/privacidad`)
      .expect(200);
    expect(porQr.body).toEqual(porCarta.body);

    await request(app.getHttpServer())
      .get(`/menu/tenant/${TENANT_ID}/restaurante/${randomUUID()}/privacidad`)
      .expect(404);
  });
});
