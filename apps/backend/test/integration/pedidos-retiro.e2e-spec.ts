import 'dotenv/config';
import { randomInt, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { PedidosTransicionService } from '../../src/pedidos/pedidos-transicion.service';
import { AnonimizarRetiroService } from '../../src/configuracion/anonimizar-retiro.service';
import { horaLocal } from '../../src/pedidos/retiro';
import { conPagoFalso, pagarPedidoParaRetirar } from './support/pago-falso';

// HU-040 (BL-210): pedidos para retirar por el enlace web del local.
//
// Todo real (Keycloak, base, RLS, transacciones y auditoría) salvo la
// pasarela y el CFE (conPagoFalso). Los tests corren en serie (--runInBand),
// así que el cambio de la configuración del retiro de TC-I-200 no pisa a
// otros: se restablece al terminar. Los pedidos del test terminan
// ENTREGADOS: no quedan en el KDS.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const ACTOR_PRUEBA = 'script:test-bl-210';
const CODIGO = /^R-\d{3}$/;

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

/** Un teléfono distinto en cada corrida (no se cruza con corridas viejas). */
const telefonoDePrueba = () => `09${randomInt(1_000_000, 9_999_999)}`;

/** HH:MM sumando horas, en el día (para armar una franja que excluya ahora). */
function sumarHoras(hora: string, horas: number): string {
  const [h, m] = hora.split(':').map(Number);
  return `${String((h + horas) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

describe('HU-040 (BL-210): pedidos para retirar', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let transicion: PedidosTransicionService;
  let anonimizar: AnonimizarRetiroService;
  let configuracionOriginal: {
    retiroHabilitado: boolean;
    retiroHoraDesde: string | null;
    retiroHoraHasta: string | null;
    timezone: string;
  };
  const pedidosCreados: string[] = [];

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  const http = () => request(app.getHttpServer());

  const tokenComensal = async () => {
    const res = await http()
      .post('/auth/comensal')
      .send({ tenantId: TENANT_ID, restauranteId: RESTAURANTE_ID })
      .expect(200);
    return res.body.accessToken as string;
  };

  /** POST /pedidos por el enlace web, como el frontend. */
  const pedirParaRetirar = (
    token: string,
    contactoRetiro?: Record<string, unknown>,
  ) =>
    http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        restauranteId: RESTAURANTE_ID,
        idempotencyKey: `bl-210-${randomUUID()}`,
        items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
        contactoRetiro,
      });

  /** Crea el pedido para retirar y lo paga con la pasarela falsa. */
  const pedidoPagado = async (contactoRetiro?: Record<string, unknown>) => {
    const token = await tokenComensal();
    const res = await pedirParaRetirar(token, contactoRetiro).expect(201);
    const { id, tokenAcceso } = res.body as { id: string; tokenAcceso: string };
    pedidosCreados.push(id);
    await pagarPedidoParaRetirar(app, id, token, tokenAcceso);
    return { id, token, tokenAcceso };
  };

  const leer = (pedidoId: string) =>
    enTenant<{
      estado: string;
      codigoRetiro: string | null;
      retiroNombre: string | null;
      retiroContacto: string | null;
      retiroConsentidoEn: Date | null;
      retiroAnonimizadoEn: Date | null;
      mesa: { esVirtual: boolean; numero: number };
    }>((tx) =>
      tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: {
          estado: true,
          codigoRetiro: true,
          retiroNombre: true,
          retiroContacto: true,
          retiroConsentidoEn: true,
          retiroAnonimizadoEn: true,
          mesa: { select: { esVirtual: true, numero: true } },
        },
      }),
    );

  const configurarRetiro = (data: {
    retiroHabilitado?: boolean;
    retiroHoraDesde?: string | null;
    retiroHoraHasta?: string | null;
  }) =>
    enTenant((tx) =>
      tx.restaurante.update({ where: { id: RESTAURANTE_ID }, data }),
    );

  const pasarALista = (pedidoId: string) =>
    enTenant((tx) =>
      tx.pedido.update({
        where: { id: pedidoId },
        data: { estado: 'LISTO_PARA_ENTREGAR' },
      }),
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    transicion = await app.resolve(PedidosTransicionService);
    anonimizar = await app.resolve(AnonimizarRetiroService);
    configuracionOriginal = await enTenant((tx) =>
      tx.restaurante.findUniqueOrThrow({
        where: { id: RESTAURANTE_ID },
        select: {
          retiroHabilitado: true,
          retiroHoraDesde: true,
          retiroHoraHasta: true,
          timezone: true,
        },
      }),
    );
    // Los tests parten del local tomando pedidos todo el día.
    await configurarRetiro({
      retiroHabilitado: true,
      retiroHoraDesde: null,
      retiroHoraHasta: null,
    });
  }, 30000);

  afterAll(async () => {
    if (configuracionOriginal) {
      await configurarRetiro({
        retiroHabilitado: configuracionOriginal.retiroHabilitado,
        retiroHoraDesde: configuracionOriginal.retiroHoraDesde,
        retiroHoraHasta: configuracionOriginal.retiroHoraHasta,
      }).catch(() => undefined);
    }
    await enTenant((tx) =>
      tx.pedido.updateMany({
        where: {
          id: { in: pedidosCreados },
          estado: { notIn: ['ENTREGADO', 'CANCELADO'] },
        },
        data: { estado: 'ENTREGADO' },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-199] Retiro: al aprobarse el pago el pedido para retirar toma el próximo código R-NNN; el código se ve en el estado del pago y en el KDS con el nombre, y sin consentimiento no se guardan los datos del comensal', async () => {
    const telefono = telefonoDePrueba();
    const conDatos = await pedidoPagado({
      nombre: '  Ana   Prueba ',
      contacto: `${telefono.slice(0, 3)} ${telefono.slice(3)}`,
      consentimiento: true,
    });
    const sinConsentimiento = await pedidoPagado({
      nombre: 'Otra Prueba',
      contacto: telefonoDePrueba(),
      consentimiento: false,
    });

    const primero = await leer(conDatos.id);
    const segundo = await leer(sinConsentimiento.id);
    expect(primero).toMatchObject({
      estado: 'RECIBIDO',
      codigoRetiro: expect.stringMatching(CODIGO),
      retiroNombre: 'Ana Prueba',
      retiroContacto: telefono,
      retiroConsentidoEn: expect.any(Date),
      mesa: { esVirtual: true },
    });
    expect(segundo).toMatchObject({
      estado: 'RECIBIDO',
      retiroNombre: null,
      retiroContacto: null,
      retiroConsentidoEn: null,
    });
    // El contador es por local y da la vuelta después del 999.
    const numero = Number(primero.codigoRetiro!.slice(2));
    expect(segundo.codigoRetiro).toBe(
      `R-${String((numero % 999) + 1).padStart(3, '0')}`,
    );

    // El comensal lo ve en la pantalla de pago aprobado.
    const estado = await http()
      .get(`/pedidos/${conDatos.id}/pagos`)
      .set('Authorization', `Bearer ${conDatos.token}`)
      .set('X-Pedido-Token', conDatos.tokenAcceso)
      .expect(200);
    expect(estado.body.codigoRetiro).toBe(primero.codigoRetiro);

    // El KDS lo muestra con el código y el nombre.
    const kds = await transicion.listarPendientes(TENANT_ID);
    expect(kds.find((p) => p.id === conDatos.id)?.retiro).toEqual({
      codigo: primero.codigoRetiro,
      nombre: 'Ana Prueba',
    });
    expect(kds.find((p) => p.id === sinConsentimiento.id)?.retiro).toEqual({
      codigo: segundo.codigoRetiro,
      nombre: null,
    });
  });

  it('[TC-I-200] Retiro: con los pedidos para retirar deshabilitados o fuera del horario el menú lo indica y POST /pedidos responde 409 RETIRO_NO_DISPONIBLE; dentro del horario se puede pedir', async () => {
    const token = await tokenComensal();
    const menu = () =>
      http()
        .get(`/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`)
        .expect(200);
    const ahora = horaLocal(new Date(), configuracionOriginal.timezone);

    try {
      await configurarRetiro({ retiroHabilitado: false });
      expect((await menu()).body.retiro).toEqual({
        habilitado: false,
        abierto: false,
        horaDesde: null,
        horaHasta: null,
      });
      const deshabilitado = await pedirParaRetirar(token).expect(409);
      expect(deshabilitado.body).toMatchObject({
        codigo: 'RETIRO_NO_DISPONIBLE',
        message: 'Este local no está tomando pedidos para retirar.',
      });

      const desde = sumarHoras(ahora, 2);
      const hasta = sumarHoras(ahora, 3);
      await configurarRetiro({
        retiroHabilitado: true,
        retiroHoraDesde: desde,
        retiroHoraHasta: hasta,
      });
      expect((await menu()).body.retiro).toEqual({
        habilitado: true,
        abierto: false,
        horaDesde: desde,
        horaHasta: hasta,
      });
      const fueraDeHora = await pedirParaRetirar(token).expect(409);
      expect(fueraDeHora.body).toMatchObject({
        codigo: 'RETIRO_NO_DISPONIBLE',
        message: `Este local toma pedidos para retirar de ${desde} a ${hasta}.`,
      });

      // Una franja de una hora antes a una hora después de ahora.
      await configurarRetiro({
        retiroHoraDesde: sumarHoras(ahora, 23),
        retiroHoraHasta: sumarHoras(ahora, 1),
      });
      expect((await menu()).body.retiro.abierto).toBe(true);
      const dentro = await pedirParaRetirar(token).expect(201);
      pedidosCreados.push(dentro.body.id);
    } finally {
      await configurarRetiro({
        retiroHabilitado: true,
        retiroHoraDesde: null,
        retiroHoraHasta: null,
      });
    }
  });

  it('[TC-I-201] Retiro: anonimizar un contacto borra el nombre y el contacto de sus pedidos y lo audita sin el contacto; el código, los pagos, los montos y los pedidos de otro contacto quedan intactos', async () => {
    const telefono = telefonoDePrueba();
    const otro = telefonoDePrueba();
    const primero = await pedidoPagado({
      nombre: 'Ana Prueba',
      contacto: telefono,
      consentimiento: true,
    });
    const segundo = await pedidoPagado({
      nombre: 'Ana P.',
      contacto: `${telefono.slice(0, 3)}-${telefono.slice(3)}`,
      consentimiento: true,
    });
    const deOtro = await pedidoPagado({
      nombre: 'Otra Prueba',
      contacto: otro,
      consentimiento: true,
    });

    const intacto = (pedidoId: string) =>
      enTenant((tx) =>
        tx.pedido.findUniqueOrThrow({
          where: { id: pedidoId },
          select: {
            estado: true,
            codigoRetiro: true,
            pagos: { select: { monto: true, estado: true } },
            lineas: { select: { subtotal: true, nombreSnapshot: true } },
          },
        }),
      );
    const antes = await Promise.all([primero.id, segundo.id].map(intacto));
    const desde = new Date(Date.now() - 2000);

    await expect(
      anonimizar.anonimizar(TENANT_ID, telefono, { id: ACTOR_PRUEBA }),
    ).resolves.toEqual({ pedidos: 2 });

    for (const { id } of [primero, segundo]) {
      expect(await leer(id)).toMatchObject({
        retiroNombre: null,
        retiroContacto: null,
        // Se conserva: es la prueba de que el comensal había consentido.
        retiroConsentidoEn: expect.any(Date),
        retiroAnonimizadoEn: expect.any(Date),
      });
    }
    expect(await Promise.all([primero.id, segundo.id].map(intacto))).toEqual(
      antes,
    );
    expect(antes[0]).toMatchObject({
      codigoRetiro: expect.stringMatching(CODIGO),
      pagos: [{ estado: 'APROBADO' }],
    });
    expect(await leer(deOtro.id)).toMatchObject({
      retiroNombre: 'Otra Prueba',
      retiroContacto: otro,
      retiroAnonimizadoEn: null,
    });

    const auditoria = await enTenant<
      { entidad: string; detalle: Prisma.JsonValue }[]
    >((tx) =>
      tx.registroAuditoria.findMany({
        where: {
          accion: 'PEDIDO_RETIRO_ANONIMIZADO',
          actorKeycloakId: ACTOR_PRUEBA,
          createdAt: { gte: desde },
        },
        select: { entidad: true, detalle: true },
      }),
    );
    expect(auditoria).toEqual([{ entidad: 'pedido', detalle: { pedidos: 2 } }]);
    expect(JSON.stringify(auditoria)).not.toContain(telefono);

    await expect(
      anonimizar.anonimizar(TENANT_ID, telefono, { id: ACTOR_PRUEBA }),
    ).resolves.toEqual({ pedidos: 0 });
  });

  itConMozoYCocina(
    '[TC-I-202] Retiro: el pedido listo se entrega solo con su código (POST /pedidos/:id/entregar-retiro); el pase común a ENTREGADO del KDS se rechaza y Cocina no puede entregar',
    async () => {
      const { id } = await pedidoPagado();
      const { codigoRetiro } = await leer(id);
      const numero = Number(codigoRetiro!.slice(2));
      const otroCodigo = `R-${String((numero % 999) + 1).padStart(3, '0')}`;
      const mozo = await getToken(MOZO_USER as string, MOZO_PASS as string);
      const cocina = await getToken(
        COCINA_USER as string,
        COCINA_PASS as string,
      );
      const entregar = (token: string, codigo: string, pedidoId = id) =>
        http()
          .post(`/pedidos/${pedidoId}/entregar-retiro`)
          .set('Authorization', `Bearer ${token}`)
          .send({ codigo });

      // Todavía en cocina.
      const enCocina = await entregar(mozo, codigoRetiro!).expect(409);
      expect(enCocina.body.message).toBe(
        'El pedido todavía no está listo para retirar',
      );

      await pasarALista(id);

      // El botón común del KDS no lo entrega.
      const { sub: keycloakId } = JSON.parse(
        Buffer.from(mozo.split('.')[1], 'base64url').toString('utf8'),
      ) as { sub: string };
      await expect(
        transicion.transicionar({
          tenantId: TENANT_ID,
          keycloakId,
          pedidoId: id,
          nuevoEstado: 'ENTREGADO',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await entregar(cocina, codigoRetiro!).expect(403);
      await entregar(mozo, 'hola').expect(400);
      await entregar(mozo, codigoRetiro!, 'no-es-uuid').expect(400);
      await entregar(mozo, codigoRetiro!, randomUUID()).expect(404);
      const distinto = await entregar(mozo, otroCodigo).expect(409);
      expect(distinto.body.message).toBe(
        `El código no coincide: este pedido es el ${codigoRetiro}. Revisá el pedido antes de entregarlo.`,
      );
      expect((await leer(id)).estado).toBe('LISTO_PARA_ENTREGAR');

      // Como lo escribe el colaborador: «r42» vale por «R-042».
      const entregado = await entregar(mozo, `r${numero}`).expect(200);
      expect(entregado.body).toMatchObject({ id, estado: 'ENTREGADO' });
      expect((await leer(id)).estado).toBe('ENTREGADO');

      const historial = await enTenant<{ estadoNuevo: string }[]>((tx) =>
        tx.pedidoEstadoHistorial.findMany({
          where: { pedidoId: id, estadoNuevo: 'ENTREGADO' },
          select: { estadoNuevo: true },
        }),
      );
      expect(historial).toHaveLength(1);

      const otraVez = await entregar(mozo, codigoRetiro!).expect(409);
      expect(otraVez.body.message).toBe('Este pedido ya se entregó');
    },
  );
});
