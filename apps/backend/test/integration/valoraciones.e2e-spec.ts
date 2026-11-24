import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { PedidoEstado } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { ValoracionesService } from '../../src/valoraciones/valoraciones.service';
import {
  CODIGO_YA_VALORADO,
  MENSAJE_AUN_NO_ENTREGADO,
} from '../../src/valoraciones/valoracion';
import { asegurarClaveQr } from './support/qr-mesa';

// HU-050 (BL-558): valoración privada del pedido, con la base y RLS reales.
// El control de acceso del comensal (QR, token del pedido o link de pago)
// lo prueban los tests de PedidoAccesoGuard.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';

describe('HU-050 (BL-558): valoración privada del pedido', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let valoraciones: ValoracionesService;

  /** Un pedido para retirar del local, en el estado pedido. */
  const pedido = (estado: PedidoEstado) =>
    tenantPrisma.runInTenantContext(TENANT_ID, async (tx) => {
      const mesa = await tx.mesa.findFirstOrThrow({
        where: { restauranteId: RESTAURANTE_ID, esVirtual: true },
        select: { id: true },
      });
      const creado = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId: mesa.id,
          idempotencyKey: `bl-558-${randomUUID()}`,
          estado,
          canal: 'WEB',
        },
        select: { id: true },
      });
      return creado.id;
    });

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    valoraciones = await app.resolve(ValoracionesService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('[TC-I-234] el comensal valora una sola vez su pedido entregado; el administrador ve el promedio y el comentario sin el pedido, y otro local no lo ve', async () => {
    const entregado = await pedido(PedidoEstado.ENTREGADO);
    const enCocina = await pedido(PedidoEstado.EN_PREPARACION);
    const comentario = `Muy rico, tardó un poco (${randomUUID().slice(0, 8)})`;

    await expect(
      valoraciones.valorar(TENANT_ID, entregado, { estrellas: 4, comentario }),
    ).resolves.toEqual({ valorado: true });

    // La segunda, del mismo pedido: 409 con el código, y queda la primera.
    const segunda = await valoraciones
      .valorar(TENANT_ID, entregado, { estrellas: 1 })
      .catch((e: unknown) => e);
    expect(segunda).toBeInstanceOf(ConflictException);
    expect((segunda as ConflictException).getResponse()).toMatchObject({
      codigo: CODIGO_YA_VALORADO,
    });

    // Antes de la entrega no se puede.
    await expect(
      valoraciones.valorar(TENANT_ID, enCocina, { estrellas: 5 }),
    ).rejects.toThrow(MENSAJE_AUN_NO_ENTREGADO);

    const delLocal = await valoraciones.listar(TENANT_ID, { periodo: 'HOY' });
    expect(delLocal.total).toBeGreaterThanOrEqual(1);
    expect(delLocal.promedio).not.toBeNull();
    const fila = delLocal.comentarios.find((c) => c.comentario === comentario);
    expect(fila).toEqual({
      dia: delLocal.rango.hasta,
      estrellas: 4,
      comentario,
    });
    // Sin el pedido ni la mesa.
    expect(Object.keys(fila!)).toEqual(['dia', 'estrellas', 'comentario']);

    // RLS: desde otro tenant no se ve (aunque se pida por la clave).
    const ajena = await tenantPrisma.runInTenantContext(TENANT_B, (tx) =>
      tx.valoracionPedido.findUnique({ where: { pedidoId: entregado } }),
    );
    expect(ajena).toBeNull();

    // La base también rechaza estrellas fuera de rango (CHECK).
    await expect(
      tenantPrisma.runInTenantContext(TENANT_ID, (tx) =>
        tx.valoracionPedido.create({
          data: {
            pedidoId: enCocina,
            tenantId: TENANT_ID,
            dia: new Date(),
            estrellas: 6,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
