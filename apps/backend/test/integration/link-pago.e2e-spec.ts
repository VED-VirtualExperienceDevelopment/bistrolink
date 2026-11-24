import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { PedidosService } from '../../src/pedidos/pedidos.service';
import { LinkPagoService } from '../../src/link-pago/link-pago.service';
import { olvidarClaveLinkPago } from '../../src/link-pago/link-pago-token';
import {
  CODIGO_LINK_ACTIVO,
  CODIGO_LINK_CADUCADO,
  CODIGO_LINK_REEMPLAZADO,
  CODIGO_LINK_VENCIDO,
  MENSAJE_LINK_CADUCADO,
  MENSAJE_LINK_REEMPLAZADO,
  MENSAJE_LINK_VENCIDO,
  MENSAJE_NO_ESPERA_PAGO,
  MENSAJE_PAGO_EN_CURSO,
} from '../../src/link-pago/link-pago';
import { LIMITE_APERTURAS_LINK_POR_MINUTO } from '../../src/link-pago/link-pago-throttler.guard';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import { conPagoFalso } from './support/pago-falso';
import { asegurarClaveQr } from './support/qr-mesa';

// HU-033 (BL-203): link de pago que genera el mozo para que el comensal
// pague un pedido pendiente desde su celular.
//
// Todo es real (base, RLS, Keycloak para el JWT del comensal, guard y flujo
// de pago) salvo la pasarela (conPagoFalso: aprueba siempre, como el
// sandbox) y el CFE, que está apagado.
//
// Usa una mesa propia (número 71 del tenant A), que al terminar queda LIBRE.
// Los pedidos los carga el mozo del seed (HU-039); al terminar cada test, lo
// que quedó sin entregar se cancela.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const NUMERO_MESA_TEST = 71;

const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;
const COCINA_USER = process.env.TEST_COCINA_USERNAME;
const COCINA_PASS = process.env.TEST_COCINA_PASSWORD;
const itConMozoYCocina =
  MOZO_USER && MOZO_PASS && COCINA_USER && COCINA_PASS ? it : it.skip;

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

describe('HU-033 (BL-203): pago por link', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let pedidos: PedidosService;
  let linkPago: LinkPagoService;
  let mesaId: string;
  let mozo: { id: string; keycloakId: string };

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  /** Pedido cargado por el mozo (HU-039): queda en PENDIENTE_PAGO. */
  const pedidoPendiente = async (): Promise<string> => {
    const pedido = await pedidos.crearPorMozo(TENANT_ID, mozo.keycloakId, {
      mesaId,
      idempotencyKey: `bl-203-${randomUUID()}`,
      items: [{ itemCartaId: ITEM_ID, cantidad: 2 }],
    });
    return pedido.id;
  };

  /** Con `reemplazar`, como cuando el mozo confirma «Generar otro link». */
  const generar = (pedidoId: string, reemplazar = false) =>
    linkPago.generar({
      tenantId: TENANT_ID,
      keycloakId: mozo.keycloakId,
      pedidoId,
      reemplazar,
    });

  /** El 409 de «ya hay un link activo» (otro colaborador lo generó). */
  const otroLinkActivo = (e: unknown) =>
    (e as { getResponse?: () => unknown }).getResponse?.();

  const tokenDelLink = (url: string) => url.split('/pagar/')[1];

  /** POST /auth/comensal/link-pago: el JWT del comensal sale del link. */
  const abrir = (token: string) =>
    request(app.getHttpServer())
      .post('/auth/comensal/link-pago')
      .send({ linkToken: token });

  const pagar = (pedidoId: string, jwt: string, token: string) =>
    request(app.getHttpServer())
      .post(`/pedidos/${pedidoId}/pagos`)
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Link-Pago', token)
      .send({
        idempotencyKey: `it-link-${randomUUID()}`,
        medioPago: 'MERCADOPAGO',
        datosPasarela: {},
      });

  const leer = (pedidoId: string) =>
    enTenant<{ estado: string; pagos: { estado: string }[] }>((tx) =>
      tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: { estado: true, pagos: { select: { estado: true } } },
      }),
    );

  beforeAll(async () => {
    asegurarClaveQr();
    olvidarClaveLinkPago();
    process.env.FRONTEND_URL ??= 'http://localhost:3000';
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    // El mismo ValidationPipe que main.ts (los tests no levantan main.ts).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    pedidos = await app.resolve(PedidosService);
    linkPago = await app.resolve(LinkPagoService);

    mozo = await enTenant((tx) =>
      tx.usuario.findFirstOrThrow({
        where: { rol: 'MOZO', activo: true },
        select: { id: true, keycloakId: true },
      }),
    );
    const mesa = await enTenant<{ id: string }>(async (tx) => {
      const existente = await tx.mesa.findFirst({
        where: { restauranteId: RESTAURANTE_ID, numero: NUMERO_MESA_TEST },
        select: { id: true },
      });
      return (
        existente ??
        tx.mesa.create({
          data: {
            tenantId: TENANT_ID,
            restauranteId: RESTAURANTE_ID,
            numero: NUMERO_MESA_TEST,
            estado: 'LIBRE',
          },
          select: { id: true },
        })
      );
    });
    mesaId = mesa.id;
    await enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: {
          estado: 'OCUPADA',
          sesionId: randomUUID(),
          sesionAbiertaEn: new Date(),
        },
      }),
    );
  }, 30000);

  afterEach(async () => {
    await enTenant((tx) =>
      tx.pedido.updateMany({
        where: { mesaId, estado: { notIn: ['ENTREGADO', 'CANCELADO'] } },
        data: { estado: 'CANCELADO' },
      }),
    );
    // La mesa vuelve a OCUPADA (el pago la pasa a EN_PROCESO_DE_PAGO).
    await enTenant((tx) =>
      tx.mesa.update({ where: { id: mesaId }, data: { estado: 'OCUPADA' } }),
    );
  });

  afterAll(async () => {
    await enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-210] HU-033: link generado por el mozo → el comensal lo abre y paga con la pasarela → el pedido pasa a RECIBIDO', async () => {
    const pedidoId = await pedidoPendiente();
    const link = await generar(pedidoId);
    const token = tokenDelLink(link.url);

    // El link no expone ids internos.
    expect(link.url).toMatch(/\/pagar\/[A-Za-z0-9_-]{103}$/);
    for (const id of [TENANT_ID, RESTAURANTE_ID, pedidoId, mesaId]) {
      expect(link.url).not.toContain(id);
    }

    const sesion = await abrir(token).expect(200);
    const jwt = sesion.body.accessToken as string;

    const resumen = await request(app.getHttpServer())
      .get('/link-pago')
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Link-Pago', token)
      .expect(200);
    expect(resumen.body).toMatchObject({
      pedidoId,
      estadoPedido: 'PENDIENTE_PAGO',
      mesaNumero: NUMERO_MESA_TEST,
      venceEn: link.venceEn,
    });
    expect(Number(resumen.body.consumo)).toBeGreaterThan(0);

    await pagar(pedidoId, jwt, token).expect(201);
    expect(await leer(pedidoId)).toMatchObject({
      estado: 'RECIBIDO',
      pagos: [{ estado: 'APROBADO' }],
    });

    // Con el pedido pagado, el link sirve para ver el estado (no para pagar).
    await abrir(token).expect(200);
    await request(app.getHttpServer())
      .get(`/pedidos/${pedidoId}/pagos`)
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Link-Pago', token)
      .expect(200);
  });

  it('[TC-I-211] HU-033: generar otro link invalida el anterior: no abre (410) y la pasarela no cobra', async () => {
    const pedidoId = await pedidoPendiente();
    const viejo = tokenDelLink((await generar(pedidoId)).url);
    const jwt = (await abrir(viejo).expect(200)).body.accessToken as string;
    const nuevo = tokenDelLink((await generar(pedidoId, true)).url);

    const rechazo = await abrir(viejo).expect(410);
    expect(rechazo.body).toMatchObject({
      codigo: CODIGO_LINK_REEMPLAZADO,
      message: MENSAJE_LINK_REEMPLAZADO,
    });
    const pago = await pagar(pedidoId, jwt, viejo).expect(403);
    expect(pago.body.message).toBe(MENSAJE_LINK_REEMPLAZADO);
    expect(await leer(pedidoId)).toEqual({
      estado: 'PENDIENTE_PAGO',
      pagos: [],
    });

    // El nuevo sí sirve.
    await abrir(nuevo).expect(200);
  });

  it('[TC-I-212] HU-033: link vencido: no abre (410) y la pasarela no cobra', async () => {
    const pedidoId = await pedidoPendiente();
    const token = tokenDelLink((await generar(pedidoId)).url);
    const jwt = (await abrir(token).expect(200)).body.accessToken as string;
    await enTenant((tx) =>
      tx.pedido.update({
        where: { id: pedidoId },
        data: { linkPagoVenceEn: new Date(Date.now() - 1000) },
      }),
    );

    const rechazo = await abrir(token).expect(410);
    expect(rechazo.body).toMatchObject({
      codigo: CODIGO_LINK_VENCIDO,
      message: MENSAJE_LINK_VENCIDO,
    });
    const pago = await pagar(pedidoId, jwt, token).expect(403);
    expect(pago.body.message).toBe(MENSAJE_LINK_VENCIDO);
    expect(await leer(pedidoId)).toEqual({
      estado: 'PENDIENTE_PAGO',
      pagos: [],
    });
  });

  it('[TC-I-213] HU-033: el link no sirve para otro pedido ni adulterado; no se genera sin pago pendiente o con un pago en curso; se audita sin el link', async () => {
    const pedidoA = await pedidoPendiente();
    const pedidoB = await pedidoPendiente();
    const tokenA = tokenDelLink((await generar(pedidoA)).url);
    const jwt = (await abrir(tokenA).expect(200)).body.accessToken as string;

    // El link de A no paga B.
    await pagar(pedidoB, jwt, tokenA).expect(403);
    expect((await leer(pedidoB)).pagos).toEqual([]);

    // Adulterado o inventado: 404 (sin decir por qué).
    const cambiado =
      tokenA.slice(0, 50) + (tokenA[50] === 'A' ? 'B' : 'A') + tokenA.slice(51);
    await abrir(cambiado).expect(404);
    await abrir('x'.repeat(103)).expect(404);
    await abrir('../admin').expect(400);

    // Sin pago pendiente o con un pago en curso: 409.
    await enTenant((tx) =>
      tx.pago.create({
        data: {
          tenantId: TENANT_ID,
          pedidoId: pedidoB,
          idempotencyKey: `bl-203-en-curso-${randomUUID()}`,
          monto: 1,
          medioPago: 'MERCADOPAGO',
          estado: 'PENDIENTE',
        },
      }),
    );
    await expect(generar(pedidoB)).rejects.toThrow(MENSAJE_PAGO_EN_CURSO);
    await enTenant((tx) =>
      tx.pedido.update({
        where: { id: pedidoA },
        data: { estado: 'CANCELADO' },
      }),
    );
    await expect(generar(pedidoA)).rejects.toThrow(MENSAJE_NO_ESPERA_PAGO);

    // La auditoría registra quién lo generó, sin el link.
    const auditoria = await enTenant<
      { actorKeycloakId: string | null; detalle: unknown }[]
    >((tx) =>
      tx.registroAuditoria.findMany({
        where: {
          accion: AuditAction.PEDIDO_LINK_PAGO_GENERADO,
          entidadId: pedidoA,
        },
        select: { actorKeycloakId: true, detalle: true },
      }),
    );
    expect(auditoria).toHaveLength(1);
    expect(JSON.stringify(auditoria)).not.toContain(tokenA);
  });

  it('[TC-I-215] HU-033: varios colaboradores: con un link activo no se reemplaza sin confirmar, y si dos generan a la vez solo uno lo consigue', async () => {
    // Pantalla vieja: el mozo B no sabe que el mozo A ya generó un link.
    const pedidoId = await pedidoPendiente();
    const deA = tokenDelLink((await generar(pedidoId)).url);
    const rechazo = await generar(pedidoId).catch((e) => e);
    expect(otroLinkActivo(rechazo)).toMatchObject({
      statusCode: 409,
      codigo: CODIGO_LINK_ACTIVO,
    });
    // El link de A sigue sirviendo.
    await abrir(deA).expect(200);

    // A la vez: uno solo genera; el otro recibe el mismo 409.
    const otro = await pedidoPendiente();
    const intentos = await Promise.allSettled([generar(otro), generar(otro)]);
    const generados = intentos.filter((i) => i.status === 'fulfilled');
    const rechazados = intentos.filter(
      (i): i is PromiseRejectedResult => i.status === 'rejected',
    );
    expect(generados).toHaveLength(1);
    expect(otroLinkActivo(rechazados[0].reason)).toMatchObject({
      codigo: CODIGO_LINK_ACTIVO,
    });
    const elQueQuedo = tokenDelLink(
      (generados[0] as PromiseFulfilledResult<{ url: string }>).value.url,
    );
    await abrir(elQueQuedo).expect(200);

    // Una sola entrada de auditoría por cada link generado.
    const auditoria = await enTenant<unknown[]>((tx) =>
      tx.registroAuditoria.findMany({
        where: {
          accion: AuditAction.PEDIDO_LINK_PAGO_GENERADO,
          entidadId: otro,
        },
      }),
    );
    expect(auditoria).toHaveLength(1);
  });

  it('[TC-I-216] HU-033: 24 h después de vencer el link no sirve ni para ver el comprobante, y abrirlo tiene límite por minuto', async () => {
    const pedidoId = await pedidoPendiente();
    const token = tokenDelLink((await generar(pedidoId)).url);
    const jwt = (await abrir(token).expect(200)).body.accessToken as string;
    await pagar(pedidoId, jwt, token).expect(201);
    await request(app.getHttpServer())
      .get(`/pedidos/${pedidoId}/pagos`)
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Link-Pago', token)
      .expect(200);

    // Pasaron 24 h desde que venció.
    await enTenant((tx) =>
      tx.pedido.update({
        where: { id: pedidoId },
        data: {
          linkPagoVenceEn: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000),
        },
      }),
    );
    const rechazo = await abrir(token).expect(410);
    expect(rechazo.body).toMatchObject({
      codigo: CODIGO_LINK_CADUCADO,
      message: MENSAJE_LINK_CADUCADO,
    });
    const consulta = await request(app.getHttpServer())
      .get(`/pedidos/${pedidoId}/pagos`)
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Link-Pago', token)
      .expect(403);
    expect(consulta.body.message).toBe(MENSAJE_LINK_CADUCADO);

    // Límite por link: ya se abrió 2 veces en este minuto; al pasar el
    // límite responde 429. Otro link no comparte el cupo.
    for (let i = 2; i < LIMITE_APERTURAS_LINK_POR_MINUTO; i++) {
      await abrir(token).expect(410);
    }
    await abrir(token).expect(429);
    const otro = tokenDelLink((await generar(await pedidoPendiente())).url);
    await abrir(otro).expect(200);
  });

  itConMozoYCocina(
    '[TC-I-214] HU-033: el mozo genera el link por la API (POST /cobros/pendientes/:id/link-pago) y la cocina no puede',
    async () => {
      const pedidoId = await pedidoPendiente();
      const tokenMozo = await getToken(MOZO_USER!, MOZO_PASS!);
      const tokenCocina = await getToken(COCINA_USER!, COCINA_PASS!);
      const ruta = `/cobros/pendientes/${pedidoId}/link-pago`;

      await request(app.getHttpServer())
        .post(ruta)
        .set('Authorization', `Bearer ${tokenCocina}`)
        .expect(403);
      const res = await request(app.getHttpServer())
        .post(ruta)
        .set('Authorization', `Bearer ${tokenMozo}`)
        .expect(200);
      expect(res.body.url).toMatch(/\/pagar\/[A-Za-z0-9_-]{103}$/);

      // En cobros pendientes se ve hasta cuándo sirve, nunca el link.
      const pendientes = await request(app.getHttpServer())
        .get('/cobros/pendientes')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .expect(200);
      const fila = pendientes.body.pedidos.find(
        (p: { id: string }) => p.id === pedidoId,
      );
      expect(fila.linkPagoVenceEn).toBe(res.body.venceEn);
      expect(JSON.stringify(pendientes.body)).not.toContain(
        tokenDelLink(res.body.url),
      );
    },
    30000,
  );
});
