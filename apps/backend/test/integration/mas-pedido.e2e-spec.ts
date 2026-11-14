import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { platosMasPedidos } from '../../src/menu/mas-pedidos';

/**
 * HU-045 (BL-547): insignia «Más pedido» con ventas reales.
 *
 * Las ventas se cargan directo en resumen_platos_hora (como en
 * reportes.e2e-spec.ts) para platos de una categoría de prueba, que se borra
 * al terminar. El ranking se prueba con esos platos como candidatos: así no
 * depende de lo que vendan otras suites en la misma base.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

describe('HU-045: «Más pedido» (integración)', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let categoriaId: string;
  const ids: Record<string, string> = {};
  const ahora = new Date();
  const haceDias = (dias: number) =>
    new Date(Math.floor((ahora.getTime() - dias * DIA_MS) / HORA_MS) * HORA_MS);

  /** Unidades vendidas por plato y hace cuántos días. */
  const VENTAS: [string, number, number][] = [
    ['Muy vendido', 10_000, 1],
    ['Segundo', 20, 2],
    ['Empate viejo', 12, 5],
    ['Empate reciente', 12, 1],
    ['Fuera de la ventana', 50, 31],
    ['Pocas ventas', 9, 1],
  ];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);

    await tenantPrisma.runInTenantContext(TENANT_ID, async (tx) => {
      const categoria = await tx.categoriaCarta.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          nombre: `HU-045 ${randomUUID().slice(0, 8)}`,
          orden: 9000,
        },
      });
      categoriaId = categoria.id;
      for (const [k, [nombre]] of VENTAS.entries()) {
        const item = await tx.itemCarta.create({
          data: {
            tenantId: TENANT_ID,
            categoriaId,
            nombre,
            precio: '100.00',
            orden: k,
          },
        });
        ids[nombre] = item.id;
      }
      await tx.resumenPlatosHora.createMany({
        data: VENTAS.map(([nombre, cantidad, dias]) => ({
          tenantId: TENANT_ID,
          hora: haceDias(dias),
          canal: 'WEB' as const,
          itemCartaId: ids[nombre],
          nombre,
          cantidad,
          recaudado: String(cantidad * 100),
        })),
      });
    });
  }, 30000);

  afterAll(async () => {
    if (!app) return;
    if (categoriaId) {
      await tenantPrisma.runInTenantContext(TENANT_ID, async (tx) => {
        await tx.resumenPlatosHora.deleteMany({
          where: { itemCartaId: { in: Object.values(ids) } },
        });
        await tx.itemCarta.deleteMany({ where: { categoriaId } });
        await tx.categoriaCarta.delete({ where: { id: categoriaId } });
      });
    }
    await app.close();
  });

  it('[TC-I-223] HU-045: «Más pedido» son los 3 platos con más unidades en 30 días, con al menos 10; a igual cantidad gana la venta más reciente', async () => {
    const candidatos = Object.values(ids);
    const top = await tenantPrisma.runInTenantContext(TENANT_ID, (tx) =>
      platosMasPedidos(tx, TENANT_ID, candidatos, ahora),
    );
    expect(top).toEqual([
      ids['Muy vendido'],
      ids['Segundo'],
      ids['Empate reciente'],
    ]);

    // Con menos de 10 unidades (o ventas de hace más de 30 días), ninguno.
    const sinVentas = await tenantPrisma.runInTenantContext(TENANT_ID, (tx) =>
      platosMasPedidos(
        tx,
        TENANT_ID,
        [ids['Pocas ventas'], ids['Fuera de la ventana']],
        ahora,
      ),
    );
    expect(sinVentas).toEqual([]);

    // Las ventas de un tenant no cuentan para otro.
    const otroTenant = '00000000-0000-4000-8000-000000000000';
    const deOtro = await tenantPrisma.runInTenantContext(TENANT_ID, (tx) =>
      platosMasPedidos(tx, otroTenant, candidatos, ahora),
    );
    expect(deOtro).toEqual([]);
  });

  it('[TC-I-224] HU-045: el menú del comensal marca «Más pedido» sin que se pueda fijar a mano', async () => {
    const res = await request(app.getHttpServer())
      .get(`/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`)
      .expect(HttpStatus.OK);
    const items = (
      res.body.categorias as {
        id: string;
        items: { id: string; masPedido: boolean }[];
      }[]
    ).flatMap((c) => c.items);
    const deItem = (nombre: string) =>
      items.find((i) => i.id === ids[nombre])?.masPedido;

    // 10.000 unidades: seguro entre los 3 primeros de la carta.
    expect(deItem('Muy vendido')).toBe(true);
    expect(deItem('Pocas ventas')).toBe(false);
    expect(deItem('Fuera de la ventana')).toBe(false);
    // Todos los platos traen el campo, y a lo sumo 3 lo tienen en true.
    expect(items.every((i) => typeof i.masPedido === 'boolean')).toBe(true);
    expect(items.filter((i) => i.masPedido).length).toBeLessThanOrEqual(3);
  });
});
