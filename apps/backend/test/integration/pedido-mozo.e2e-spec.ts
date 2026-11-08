import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { PedidosService } from '../../src/pedidos/pedidos.service';
import { CobroEfectivoService } from '../../src/pagos/efectivo/cobro-efectivo.service';
import { MesasService } from '../../src/mesas/mesas.service';
import { conPagoFalso } from './support/pago-falso';

// HU-039 (BL-209): el mozo carga el pedido de un comensal sin celular.
//
// El CFE está apagado (conPagoFalso). Todo lo demás es real: base, RLS,
// transacciones, cobro en efectivo (BL-201) y cierre de mesa (HU-017).
//
// Usa una mesa propia (número 92 del tenant A), que al terminar queda LIBRE.
// El actor es el usuario MOZO del seed (tiene fila en `usuario`). La carta
// todavía no maneja stock (HU-005): el «stock descontado» del DoD queda para
// cuando exista.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const NUMERO_MESA_TEST = 92;

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

describe('HU-039 (BL-209): pedido cargado por el mozo', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let pedidos: PedidosService;
  let cobros: CobroEfectivoService;
  let mesas: MesasService;
  let mesaId: string;
  let mozo: { id: string; keycloakId: string };

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  const abrirMesa = () =>
    enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: {
          estado: 'OCUPADA',
          sesionId: randomUUID(),
          sesionAbiertaEn: new Date(),
        },
      }),
    );

  const solicitud = (idempotencyKey = `bl-209-${randomUUID()}`) => ({
    mesaId,
    idempotencyKey,
    items: [{ itemCartaId: ITEM_ID, cantidad: 2, observacion: 'Sin sal' }],
    observacionGeneral: 'Celíaco',
  });

  const leer = (pedidoId: string) =>
    enTenant<{
      estado: string;
      canal: string;
      usuarioId: string | null;
      observacionGeneral: string | null;
      pagos: { medioPago: string; estado: string }[];
    }>((tx) =>
      tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: {
          estado: true,
          canal: true,
          usuarioId: true,
          observacionGeneral: true,
          pagos: { select: { medioPago: true, estado: true } },
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
    pedidos = await app.resolve(PedidosService);
    cobros = await app.resolve(CobroEfectivoService);
    mesas = await app.resolve(MesasService);

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
    await abrirMesa();
  }, 30000);

  afterEach(async () => {
    // Ningún pedido de la mesa queda en cocina ni esperando el pago.
    await enTenant((tx) =>
      tx.pedido.updateMany({
        where: { mesaId, estado: { notIn: ['ENTREGADO', 'CANCELADO'] } },
        data: { estado: 'CANCELADO' },
      }),
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

  it('[TC-I-122] HU-039: pedido cargado por el mozo y cobrado en efectivo queda en RECIBIDO, con canal MOZO y el usuario que lo cargó', async () => {
    const cargado = await pedidos.crearPorMozo(
      TENANT_ID,
      mozo.keycloakId,
      solicitud(),
    );

    expect(cargado).toMatchObject({
      canal: 'MOZO',
      estado: 'PENDIENTE_PAGO',
      mesa: { id: mesaId, numero: NUMERO_MESA_TEST },
      pagoEnCurso: false,
    });
    let pedido = await leer(cargado.id);
    expect(pedido).toMatchObject({
      estado: 'PENDIENTE_PAGO',
      canal: 'MOZO',
      usuarioId: mozo.id,
      observacionGeneral: 'Celíaco',
    });

    // Aparece entre los pendientes de la mesa, como cualquier pedido.
    const { pedidos: pendientes } = await cobros.pendientes(TENANT_ID);
    expect(pendientes.map((p) => p.id)).toContain(cargado.id);

    await cobros.registrar(TENANT_ID, mozo.keycloakId, {
      pedidoId: cargado.id,
      idempotencyKey: `bl-209-${randomUUID()}`,
      montoRecibido: '100000',
    });

    pedido = await leer(cargado.id);
    expect(pedido.estado).toBe('RECIBIDO');
    expect(pedido.pagos).toEqual([
      { medioPago: 'EFECTIVO', estado: 'APROBADO' },
    ]);
  });

  it('[TC-I-123] HU-039: el mismo idempotency key dos veces crea un único pedido', async () => {
    const clave = `bl-209-${randomUUID()}`;

    const primero = await pedidos.crearPorMozo(
      TENANT_ID,
      mozo.keycloakId,
      solicitud(clave),
    );
    const segundo = await pedidos.crearPorMozo(
      TENANT_ID,
      mozo.keycloakId,
      solicitud(clave),
    );

    expect(segundo.id).toBe(primero.id);
    const cantidad = await enTenant<number>((tx) =>
      tx.pedido.count({ where: { idempotencyKey: clave } }),
    );
    expect(cantidad).toBe(1);
  });

  it('[TC-I-124] HU-039: el cierre de la mesa cancela también el pedido del mozo que no se pagó; con la mesa cerrada no se puede cargar', async () => {
    const cargado = await pedidos.crearPorMozo(
      TENANT_ID,
      mozo.keycloakId,
      solicitud(),
    );

    const cierre = await mesas.cerrarSesion(TENANT_ID, mesaId, mozo.keycloakId);

    expect(cierre.pedidosCancelados).toBeGreaterThanOrEqual(1);
    expect((await leer(cargado.id)).estado).toBe('CANCELADO');

    await expect(
      pedidos.crearPorMozo(TENANT_ID, mozo.keycloakId, solicitud()),
    ).rejects.toThrow(ConflictException);

    await abrirMesa();
  });

  itConMozoYCocina(
    '[TC-I-125] HU-039: el mozo carga el pedido por HTTP; Cocina recibe 403',
    async () => {
      const tokenMozo = await getToken(MOZO_USER!, MOZO_PASS!);
      const tokenCocina = await getToken(COCINA_USER!, COCINA_PASS!);
      const servidor = app.getHttpServer();

      await request(servidor)
        .post('/pedidos/mozo')
        .set('Authorization', `Bearer ${tokenCocina}`)
        .send(solicitud())
        .expect(403);

      const res = await request(servidor)
        .post('/pedidos/mozo')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .send(solicitud())
        .expect(201);

      expect(res.body).toMatchObject({
        canal: 'MOZO',
        estado: 'PENDIENTE_PAGO',
        mesa: { numero: NUMERO_MESA_TEST },
      });
      // El usuario que lo cargó sale del token (el mozo de prueba).
      expect((await leer(res.body.id)).usuarioId).not.toBeNull();
    },
  );
});
