import 'dotenv/config';
import { randomBytes, randomInt } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { PedidosTransicionService } from '../../src/pedidos/pedidos-transicion.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import {
  HEADER_SECRETO_WEBHOOK,
  hashTelefono,
} from '../../src/whatsapp/configuracion-whatsapp';
import { conPagoFalso } from './support/pago-falso';

// HU-010 (BL-112): bot de pedidos para retirar por WhatsApp.
//
// Todo real (base, RLS, pedidos, link de pago, auditoría) salvo Evolution
// API, que es un servidor HTTP local que guarda lo que el bot manda. El CI
// nunca habla con WhatsApp. Los secretos se generan en cada corrida; no hay
// credenciales en el test.

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_A = '22222222-2222-2222-2222-222222222222';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const INSTANCIA = 'test-bl112';

interface Enviado {
  instancia: string;
  apikey: string | undefined;
  number: string;
  text: string;
}

describe('HU-010 (BL-112): bot de pedidos por WhatsApp', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let evolution: Server;
  const enviados: Enviado[] = [];
  const pedidosCreados: string[] = [];
  const telefonosUsados: string[] = [];
  const entornoOriginal = { ...process.env };
  const secreto = randomBytes(32).toString('hex');
  const claveTelefono = randomBytes(32).toString('hex');
  const apiKey = randomBytes(16).toString('hex');
  let configuracionOriginal: {
    retiroHabilitado: boolean;
    retiroHoraDesde: string | null;
    retiroHoraHasta: string | null;
  };

  const enTenant = <T>(
    tenantId: string,
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  const telefonoNuevo = () => {
    const telefono = `59899${randomInt(100_000, 999_999)}`;
    telefonosUsados.push(telefono);
    return telefono;
  };

  let secuencia = 0;
  const evento = (
    telefono: string,
    texto: string,
    parcial: { id?: string; fromMe?: boolean; instancia?: string } = {},
  ) => ({
    event: 'messages.upsert',
    instance: parcial.instancia ?? INSTANCIA,
    data: {
      key: {
        remoteJid: `${telefono}@s.whatsapp.net`,
        fromMe: parcial.fromMe ?? false,
        id: parcial.id ?? `BL112-${Date.now()}-${(secuencia += 1)}`,
      },
      message: { conversation: texto },
    },
  });

  const webhook = (cuerpo: unknown, conSecreto: string | null = secreto) => {
    const req = request(app.getHttpServer()).post('/webhooks/whatsapp');
    if (conSecreto !== null) req.set(HEADER_SECRETO_WEBHOOK, conSecreto);
    return req.send(cuerpo as object);
  };

  /** Manda un texto y devuelve lo que el bot le contestó a ese teléfono. */
  const escribir = async (telefono: string, texto: string) => {
    const antes = enviados.length;
    await webhook(evento(telefono, texto)).expect(200);
    return enviados
      .slice(antes)
      .filter((e) => e.number === telefono)
      .map((e) => e.text)
      .join('\n');
  };

  beforeAll(async () => {
    evolution = createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (parte: Buffer) => (cuerpo += parte.toString()));
      req.on('end', () => {
        const coincide = /^\/message\/sendText\/([^/]+)$/.exec(req.url ?? '');
        if (req.method !== 'POST' || !coincide) {
          res.writeHead(404).end();
          return;
        }
        const datos = JSON.parse(cuerpo) as { number: string; text: string };
        enviados.push({
          instancia: decodeURIComponent(coincide[1]),
          apikey: req.headers.apikey as string | undefined,
          number: datos.number,
          text: datos.text,
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((ok) => evolution.listen(0, '127.0.0.1', ok));
    const { port } = evolution.address() as AddressInfo;

    Object.assign(process.env, {
      EVOLUTION_API_URL: `http://127.0.0.1:${port}`,
      EVOLUTION_API_KEY: apiKey,
      EVOLUTION_INSTANCIAS: `${INSTANCIA}=${TENANT_A}`,
      WHATSAPP_WEBHOOK_SECRETO: secreto,
      WHATSAPP_TELEFONO_CLAVE: claveTelefono,
      FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    });

    // BL-604: la pasarela falsa (aprueba siempre) para probar el aviso del
    // pago aprobado; no cambia nada de los otros casos.
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
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

    configuracionOriginal = await enTenant(TENANT_A, (tx) =>
      tx.restaurante.findUniqueOrThrow({
        where: { id: RESTAURANTE_A },
        select: {
          retiroHabilitado: true,
          retiroHoraDesde: true,
          retiroHoraHasta: true,
        },
      }),
    );
    // El bot toma pedidos para retirar: el local los toma todo el día.
    await enTenant(TENANT_A, (tx) =>
      tx.restaurante.update({
        where: { id: RESTAURANTE_A },
        data: {
          retiroHabilitado: true,
          retiroHoraDesde: null,
          retiroHoraHasta: null,
        },
      }),
    );
  }, 30000);

  afterAll(async () => {
    if (tenantPrisma) {
      if (configuracionOriginal) {
        await enTenant(TENANT_A, (tx) =>
          tx.restaurante.update({
            where: { id: RESTAURANTE_A },
            data: configuracionOriginal,
          }),
        ).catch(() => undefined);
      }
      await enTenant(TENANT_A, (tx) =>
        tx.pedido.updateMany({
          where: { id: { in: pedidosCreados }, estado: 'PENDIENTE_PAGO' },
          data: { estado: 'CANCELADO' },
        }),
      ).catch(() => undefined);
      // BL-604: el que se pagó y quedó listo no queda en el KDS.
      await enTenant(TENANT_A, (tx) =>
        tx.pedido.updateMany({
          where: {
            id: { in: pedidosCreados },
            estado: { notIn: ['ENTREGADO', 'CANCELADO'] },
          },
          data: { estado: 'ENTREGADO' },
        }),
      ).catch(() => undefined);
      const hashes = telefonosUsados.map((t) =>
        hashTelefono(claveTelefono, TENANT_A, t),
      );
      await enTenant(TENANT_A, (tx) =>
        tx.conversacionWhatsapp.deleteMany({
          where: { telefonoHash: { in: hashes } },
        }),
      ).catch(() => undefined);
    }
    process.env = { ...entornoOriginal };
    await app?.close();
    await new Promise((ok) => evolution?.close(ok));
  }, 30000);

  it('[TC-I-245] WhatsApp: el comensal acepta el aviso, arma el pedido con la carta numerada y al confirmar se crea el pedido para retirar con canal WHATSAPP y se le manda el link de pago', async () => {
    const telefono = telefonoNuevo();

    // Sin el secreto (o con otro) el webhook no hace nada.
    await webhook(evento(telefono, 'hola'), null).expect(401);
    await webhook(evento(telefono, 'hola'), 'otro-secreto').expect(401);
    expect(enviados.filter((e) => e.number === telefono)).toHaveLength(0);

    const aviso = await escribir(telefono, 'Hola');
    expect(aviso).toContain('aviso de privacidad');
    expect(aviso).toContain(`/privacidad?t=${TENANT_A}&r=${RESTAURANTE_A}`);
    expect(enviados[enviados.length - 1]).toEqual(
      expect.objectContaining({ instancia: INSTANCIA, apikey: apiKey }),
    );

    const carta = await escribir(telefono, '1');
    const item = await enTenant<{ nombre: string }>(TENANT_A, (tx) =>
      tx.itemCarta.findUniqueOrThrow({
        where: { id: ITEM_ID },
        select: { nombre: true },
      }),
    );
    const numero = new RegExp(
      String.raw`^(\d+)\. ${item.nombre.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')} · `,
      'm',
    ).exec(carta)?.[1];
    expect(numero).toBeDefined();

    expect(await escribir(telefono, `${numero} x2`)).toContain(
      `Agregué 2 × ${item.nombre}`,
    );
    const resumen = await escribir(telefono, '0');
    expect(resumen).toContain(`2 × ${item.nombre}`);
    expect(resumen).toContain('Total');

    const confirmacion = evento(telefono, '1');
    const antes = enviados.length;
    await webhook(confirmacion).expect(200);
    const respuesta = enviados
      .slice(antes)
      .map((e) => e.text)
      .join('\n');
    expect(respuesta).toMatch(/\/pagar\/\S+/);

    const pedido = await enTenant<{
      id: string;
      canal: string;
      estado: string;
      retiroContacto: string | null;
      retiroConsentidoEn: Date | null;
      linkPagoHash: string | null;
      lineas: { itemCartaId: string; cantidad: number }[];
      mesa: { esVirtual: boolean };
    } | null>(TENANT_A, (tx) =>
      tx.pedido.findFirst({
        where: { canal: 'WHATSAPP', retiroContacto: `+${telefono}` },
        select: {
          id: true,
          canal: true,
          estado: true,
          retiroContacto: true,
          retiroConsentidoEn: true,
          linkPagoHash: true,
          lineas: { select: { itemCartaId: true, cantidad: true } },
          mesa: { select: { esVirtual: true } },
        },
      }),
    );
    expect(pedido).not.toBeNull();
    pedidosCreados.push(pedido!.id);
    expect(pedido).toEqual(
      expect.objectContaining({
        canal: 'WHATSAPP',
        estado: 'PENDIENTE_PAGO',
        retiroContacto: `+${telefono}`,
        mesa: { esVirtual: true },
      }),
    );
    expect(pedido!.retiroConsentidoEn).toBeInstanceOf(Date);
    expect(pedido!.linkPagoHash).not.toBeNull();
    expect(pedido!.lineas).toEqual([{ itemCartaId: ITEM_ID, cantidad: 2 }]);

    // La auditoría del link dice que lo generó el bot.
    const auditoria = await enTenant<{ actorKeycloakId: string }[]>(
      TENANT_A,
      (tx) =>
        tx.registroAuditoria.findMany({
          where: { entidadId: pedido!.id, accion: 'PEDIDO_LINK_PAGO_GENERADO' },
          select: { actorKeycloakId: true },
        }),
    );
    expect(auditoria).toEqual([{ actorKeycloakId: 'sistema:whatsapp' }]);

    // Evolution reintenta la confirmación: no hay otro pedido ni otro mensaje.
    const antesDelReintento = enviados.length;
    await webhook(confirmacion).expect(200);
    expect(enviados.length).toBe(antesDelReintento);
    const cuantos = await enTenant<number>(TENANT_A, (tx) =>
      tx.pedido.count({
        where: { canal: 'WHATSAPP', retiroContacto: `+${telefono}` },
      }),
    );
    expect(cuantos).toBe(1);

    // La conversación quedó lista para otro pedido y sin el número en claro.
    const conversacion = await enTenant<
      { telefonoHash: string; paso: string; carrito: unknown }[]
    >(
      TENANT_A,
      (tx) =>
        tx.$queryRaw`SELECT telefono_hash AS "telefonoHash", paso, carrito
                     FROM conversacion_whatsapp
                    WHERE telefono_hash = ${hashTelefono(claveTelefono, TENANT_A, telefono)}`,
    );
    expect(conversacion).toEqual([
      expect.objectContaining({ paso: 'ARMANDO', carrito: [] }),
    ]);
    expect(JSON.stringify(conversacion)).not.toContain(telefono);
  }, 60000);

  it('[TC-I-246] WhatsApp: la conversación queda en el tenant de la instancia (RLS), y se ignoran los mensajes propios y los de una instancia sin tenant', async () => {
    const telefono = telefonoNuevo();
    await escribir(telefono, 'hola');
    const hash = hashTelefono(claveTelefono, TENANT_A, telefono);

    const enA = await enTenant<number>(TENANT_A, (tx) =>
      tx.conversacionWhatsapp.count({ where: { telefonoHash: hash } }),
    );
    const enB = await enTenant<number>(TENANT_B, (tx) =>
      tx.conversacionWhatsapp.count({ where: { telefonoHash: hash } }),
    );
    expect(enA).toBe(1);
    expect(enB).toBe(0);

    // Desde el tenant B no se puede escribir una conversación del A.
    await expect(
      enTenant(TENANT_B, (tx) =>
        tx.conversacionWhatsapp.create({
          data: {
            tenantId: TENANT_A,
            telefonoHash: 'f'.repeat(64),
            paso: 'INICIO',
            venceEn: new Date(Date.now() + 60_000),
          },
        }),
      ),
    ).rejects.toThrow();

    const antes = enviados.length;
    await webhook(evento(telefono, '1', { fromMe: true })).expect(200);
    await webhook(evento(telefono, 'hola', { instancia: 'otra' })).expect(200);
    await webhook({ event: 'connection.update', instance: INSTANCIA }).expect(
      200,
    );
    expect(enviados.length).toBe(antes);
    // El mensaje propio no aceptó el aviso.
    const fila = await enTenant<{ consentido: boolean } | null>(
      TENANT_A,
      (tx) =>
        tx.conversacionWhatsapp.findUnique({
          where: {
            tenantId_telefonoHash: { tenantId: TENANT_A, telefonoHash: hash },
          },
          select: { consentido: true },
        }),
    );
    expect(fila?.consentido).toBe(false);
  }, 60000);

  /** Lo que el bot le mandó a un teléfono, esperando hasta 5 s. */
  const esperarMensaje = async (telefono: string, patron: RegExp) => {
    for (let intento = 0; intento < 50; intento += 1) {
      const encontrado = enviados.find(
        (e) => e.number === telefono && patron.test(e.text),
      );
      if (encontrado) return encontrado.text;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`No llegó el mensaje ${patron} al teléfono de prueba`);
  };

  it('[TC-I-247] WhatsApp: al aprobarse el pago del pedido del bot le llega el código de retiro, y cuando cocina lo marca listo le llega el aviso con el mismo código', async () => {
    const telefono = telefonoNuevo();
    await escribir(telefono, 'hola');
    const carta = await escribir(telefono, '1');
    const numero = /^(\d+)\. /m.exec(carta)?.[1];
    expect(numero).toBeDefined();
    await escribir(telefono, numero!);
    await escribir(telefono, '0');
    const conLink = await escribir(telefono, '1');
    const token = /\/pagar\/([A-Za-z0-9_-]+)/.exec(conLink)?.[1];
    expect(token).toBeDefined();

    const pedido = await enTenant<{ id: string } | null>(TENANT_A, (tx) =>
      tx.pedido.findFirst({
        where: { canal: 'WHATSAPP', retiroContacto: `+${telefono}` },
        select: { id: true },
      }),
    );
    expect(pedido).not.toBeNull();
    pedidosCreados.push(pedido!.id);

    // El comensal paga por el link (pasarela falsa).
    const abierto = await request(app.getHttpServer())
      .post('/auth/comensal/link-pago')
      .send({ linkToken: token })
      .expect(200);
    const { accessToken } = abierto.body as { accessToken: string };
    await request(app.getHttpServer())
      .post(`/pedidos/${pedido!.id}/pagos`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Link-Pago', token!)
      .send({
        idempotencyKey: `it-bl604-${pedido!.id}`,
        medioPago: 'MERCADOPAGO',
        datosPasarela: {},
      })
      .expect(201);

    const { codigoRetiro } = await enTenant<{ codigoRetiro: string | null }>(
      TENANT_A,
      (tx) =>
        tx.pedido.findUniqueOrThrow({
          where: { id: pedido!.id },
          select: { codigoRetiro: true },
        }),
    );
    expect(codigoRetiro).toMatch(/^R-\d{3}$/);
    const aprobado = await esperarMensaje(telefono, /Pago aprobado/);
    expect(aprobado).toContain(`*${codigoRetiro}*`);

    // Cocina lo prepara y lo marca listo (la misma transición que el KDS).
    const mozo = await enTenant<{ keycloakId: string }>(TENANT_A, (tx) =>
      tx.usuario.findFirstOrThrow({
        where: { rol: 'MOZO', activo: true },
        select: { keycloakId: true },
      }),
    );
    const transicion = await app.resolve(PedidosTransicionService);
    for (const nuevoEstado of [
      'EN_PREPARACION',
      'LISTO_PARA_ENTREGAR',
    ] as const) {
      await transicion.transicionar({
        tenantId: TENANT_A,
        keycloakId: mozo.keycloakId,
        pedidoId: pedido!.id,
        nuevoEstado,
      });
    }
    const listo = await esperarMensaje(telefono, /está listo/);
    expect(listo).toContain(`*${codigoRetiro}*`);
    expect(listo).toContain('¡Gracias por tu compra!');

    // Un aviso de cada uno, por la instancia del tenant y con la API key.
    const avisos = enviados.filter(
      (e) => e.number === telefono && /Pago aprobado|está listo/.test(e.text),
    );
    expect(avisos).toHaveLength(2);
    for (const aviso of avisos) {
      expect(aviso).toEqual(
        expect.objectContaining({ instancia: INSTANCIA, apikey: apiKey }),
      );
    }
  }, 60000);
});
