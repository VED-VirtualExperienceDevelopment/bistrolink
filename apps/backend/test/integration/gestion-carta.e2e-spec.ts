import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { PedidosService } from '../../src/pedidos/pedidos.service';
import {
  MENSAJE_CATEGORIA_CON_ITEMS,
  MENSAJE_EDICION_CONCURRENTE,
  MENSAJE_ITEM_CON_HISTORIAL,
  MENSAJE_ORDEN_DESACTUALIZADO,
} from '../../src/menu/menu-admin.service';
import { conPagoFalso } from './support/pago-falso';

// BL-402 (BL-392): Gestión de Carta contra la base real (RLS, transacciones
// y auditoría). Solo la pasarela y el CFE son falsos (conPagoFalso).
//
// Cada corrida crea su propia categoría «BL-402 …» en el tenant A, con dos
// ítems, y al terminar la borra junto con el pedido de prueba. El orden de
// las categorías del tenant A se deja como estaba.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? 'admin-test';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;
const TENANT_B_USER = process.env.TEST_TENANT_B_USERNAME;
const TENANT_B_PASS = process.env.TEST_TENANT_B_PASSWORD;

// Sin el admin no se puede preparar nada: se salta todo el archivo (Jest
// lo reporta como «skipped», no como «passed»).
const describeConAdmin = ADMIN_USER && ADMIN_PASS ? describe : describe.skip;
const itConMozo = MOZO_USER && MOZO_PASS ? it : it.skip;
const itConTenantB = TENANT_B_USER && TENANT_B_PASS ? it : it.skip;

// Una versión que seguro es vieja, para el bloqueo optimista.
const VERSION_VIEJA = '2020-01-01T00:00:00.000Z';

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

interface CategoriaRespuesta {
  id: string;
  nombre: string;
  activo: boolean;
  updatedAt: string;
  items: { id: string }[];
}

describeConAdmin('BL-402: Gestión de Carta (integración)', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let pedidos: PedidosService;
  let tokenAdmin: string;

  let categoriaId: string;
  // Ítem que se pide (queda con historial) y ítem que se archiva.
  let itemPedidoId: string;
  let itemArchivadoId: string;
  const pedidosCreados: string[] = [];
  let ordenOriginal: string[] = [];

  const servidor = () => request(app.getHttpServer());
  const conToken = (token: string, prueba: request.Test) =>
    prueba.set('Authorization', `Bearer ${token}`);

  const leerCarta = async (token = tokenAdmin) => {
    const res = await conToken(
      token,
      servidor().get(`/admin/menu/categoria?restauranteId=${RESTAURANTE_ID}`),
    ).expect(HttpStatus.OK);
    return res.body as CategoriaRespuesta[];
  };

  const crearPedido = async (itemCartaId: string) => {
    const pedido = await pedidos.crear(TENANT_ID, {
      restauranteId: RESTAURANTE_ID,
      idempotencyKey: `bl-402-${randomUUID()}`,
      items: [{ itemCartaId, cantidad: 1 }],
    });
    pedidosCreados.push(pedido.id);
    return pedido;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    // El mismo ValidationPipe que main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    // Escuchando en un puerto fijo: TC-I-126 y 131 arman varios pedidos de
    // supertest antes de mandarlos. Sin esto, cada pedido abre y cierra el
    // servidor, y los siguientes lo encuentran cerrado.
    await app.listen(0);

    tenantPrisma = await app.resolve(TenantPrismaService);
    pedidos = await app.resolve(PedidosService);
    tokenAdmin = await getToken(ADMIN_USER as string, ADMIN_PASS as string);

    ordenOriginal = (await leerCarta()).map((c) => c.id);

    const categoria = await conToken(
      tokenAdmin,
      servidor().post('/admin/menu/categoria'),
    )
      .send({ nombre: `BL-402 ${randomUUID().slice(0, 8)}` })
      .expect(HttpStatus.CREATED);
    categoriaId = categoria.body.id;

    const crearItem = async (nombre: string) => {
      const res = await conToken(
        tokenAdmin,
        servidor().post('/admin/menu/item'),
      )
        .send({ categoriaId, nombre, precio: '120.50' })
        .expect(HttpStatus.CREATED);
      return res.body.id as string;
    };
    itemPedidoId = await crearItem('Pancho de prueba');
    itemArchivadoId = await crearItem('Flan de prueba');
  }, 30000);

  afterAll(async () => {
    if (!app) return;
    // Se borra lo creado por la prueba, en el orden que piden las FK.
    if (categoriaId) {
      await tenantPrisma.runInTenantContext(TENANT_ID, async (tx) => {
        await tx.pedidoEstadoHistorial.deleteMany({
          where: { pedidoId: { in: pedidosCreados } },
        });
        await tx.lineaPedido.deleteMany({
          where: { pedidoId: { in: pedidosCreados } },
        });
        await tx.pedido.deleteMany({ where: { id: { in: pedidosCreados } } });
        await tx.itemCarta.deleteMany({ where: { categoriaId } });
        await tx.categoriaCarta.deleteMany({ where: { id: categoriaId } });
      });
    }
    await app.close();
  }, 30000);

  // ── Permisos por rol (BL-395) ─────────────────────────────────────────────
  itConMozo(
    '[TC-I-126] Carta: el MOZO ve la carta y marca agotado; todo lo demás le da 403',
    async () => {
      const token = await getToken(MOZO_USER as string, MOZO_PASS as string);

      await conToken(
        token,
        servidor().get(`/admin/menu/categoria?restauranteId=${RESTAURANTE_ID}`),
      ).expect(HttpStatus.OK);

      await conToken(
        token,
        servidor().patch(`/admin/menu/item/${itemPedidoId}/disponibilidad`),
      )
        .send({ disponible: false })
        .expect(HttpStatus.OK);
      await conToken(
        token,
        servidor().patch(`/admin/menu/item/${itemPedidoId}/disponibilidad`),
      )
        .send({ disponible: true })
        .expect(HttpStatus.OK);

      const prohibidos: request.Test[] = [
        servidor().post('/admin/menu/categoria').send({ nombre: 'No' }),
        servidor()
          .patch(`/admin/menu/categoria/${categoriaId}`)
          .send({ nombre: 'No' }),
        servidor()
          .post('/admin/menu/item')
          .send({ categoriaId, nombre: 'No', precio: '1' }),
        servidor()
          .patch(`/admin/menu/item/${itemPedidoId}`)
          .send({ nombre: 'No' }),
        servidor().post(`/admin/menu/item/${itemPedidoId}/archivar`),
        servidor().delete(`/admin/menu/item/${itemPedidoId}`),
        servidor()
          .put('/admin/menu/categorias/orden')
          .send({ ids: ordenOriginal }),
      ];
      for (const prueba of prohibidos) {
        await conToken(token, prueba).expect(HttpStatus.FORBIDDEN);
      }
    },
  );

  // ── Bloqueo optimista (BL-394) ────────────────────────────────────────────
  it('[TC-I-127] Carta: editar con una versión vieja da 409; con la actual, 200', async () => {
    await conToken(
      tokenAdmin,
      servidor().patch(`/admin/menu/categoria/${categoriaId}`),
    )
      .send({ descripcion: 'Vieja', updatedAt: VERSION_VIEJA })
      .expect(HttpStatus.CONFLICT)
      .expect((res) =>
        expect(res.body.message).toBe(MENSAJE_EDICION_CONCURRENTE),
      );

    const actual = (await leerCarta()).find((c) => c.id === categoriaId);
    await conToken(
      tokenAdmin,
      servidor().patch(`/admin/menu/categoria/${categoriaId}`),
    )
      .send({ descripcion: 'Para probar', updatedAt: actual?.updatedAt })
      .expect(HttpStatus.OK);
  });

  // ── Pedidos de ítems ocultos o archivados (BL-397) ───────────────────────
  it('[TC-I-128] Carta: un pedido con un ítem archivado o de una categoría oculta se rechaza (400)', async () => {
    // Con todo visible, el pedido entra (y el ítem queda con historial).
    await crearPedido(itemPedidoId);

    await conToken(
      tokenAdmin,
      servidor().post(`/admin/menu/item/${itemArchivadoId}/archivar`),
    ).expect(HttpStatus.OK);
    await expect(crearPedido(itemArchivadoId)).rejects.toThrow(
      'no existe en la carta',
    );

    await conToken(
      tokenAdmin,
      servidor().patch(`/admin/menu/categoria/${categoriaId}`),
    )
      .send({ activo: false })
      .expect(HttpStatus.OK);
    await expect(crearPedido(itemPedidoId)).rejects.toThrow(
      'no existe en la carta',
    );
    await conToken(
      tokenAdmin,
      servidor().patch(`/admin/menu/categoria/${categoriaId}`),
    )
      .send({ activo: true })
      .expect(HttpStatus.OK);
  });

  // ── Eliminación definitiva solo sin historial (BL-394) ───────────────────
  it('[TC-I-129] Carta: no se elimina un ítem con pedidos ni una categoría con ítems (409)', async () => {
    await conToken(
      tokenAdmin,
      servidor().delete(`/admin/menu/item/${itemPedidoId}`),
    )
      .expect(HttpStatus.CONFLICT)
      .expect((res) =>
        expect(res.body.message).toBe(MENSAJE_ITEM_CON_HISTORIAL),
      );

    // Tiene un ítem archivado y otro activo: tampoco se elimina.
    await conToken(
      tokenAdmin,
      servidor().delete(`/admin/menu/categoria/${categoriaId}`),
    )
      .expect(HttpStatus.CONFLICT)
      .expect((res) =>
        expect(res.body.message).toBe(MENSAJE_CATEGORIA_CON_ITEMS),
      );
  });

  // ── Ordenar (BL-399) ──────────────────────────────────────────────────────
  it('[TC-I-130] Carta: reordenar guarda la lista completa; una lista incompleta da 409', async () => {
    const actuales = (await leerCarta()).map((c) => c.id);
    expect(actuales.at(-1)).toBe(categoriaId); // la nueva va al final

    await conToken(tokenAdmin, servidor().put('/admin/menu/categorias/orden'))
      .send({ ids: actuales.slice(1) })
      .expect(HttpStatus.CONFLICT)
      .expect((res) =>
        expect(res.body.message).toBe(MENSAJE_ORDEN_DESACTUALIZADO),
      );

    const invertido = [...actuales].reverse();
    await conToken(tokenAdmin, servidor().put('/admin/menu/categorias/orden'))
      .send({ ids: invertido })
      .expect(HttpStatus.OK);
    expect((await leerCarta()).map((c) => c.id)).toEqual(invertido);

    // Se deja como estaba (la categoría de prueba, al final).
    await conToken(tokenAdmin, servidor().put('/admin/menu/categorias/orden'))
      .send({ ids: actuales })
      .expect(HttpStatus.OK);
  });

  // ── «Sugerencia del local» (HU-044, BL-537) ──────────────────────────────
  it('[TC-I-221] Carta: el ADMIN marca un plato como «Sugerencia del local»; queda auditado y el comensal lo ve, sin cambiar el orden', async () => {
    const menuPublico = async () => {
      const res = await servidor()
        .get(`/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`)
        .expect(HttpStatus.OK);
      return res.body.categorias as {
        id: string;
        items: { id: string; destacado: boolean }[];
      }[];
    };
    const ordenDeLaCategoria = async () =>
      (await menuPublico())
        .find((c) => c.id === categoriaId)
        ?.items.map((i) => i.id);
    const ordenAntes = await ordenDeLaCategoria();

    // Valor que no es booleano: 400.
    await conToken(
      tokenAdmin,
      servidor().patch(`/admin/menu/item/${itemPedidoId}`),
    )
      .send({ destacado: 'si' })
      .expect(HttpStatus.BAD_REQUEST);

    await conToken(
      tokenAdmin,
      servidor().patch(`/admin/menu/item/${itemPedidoId}`),
    )
      .send({ destacado: true })
      .expect(HttpStatus.OK)
      .expect((res) => expect(res.body.destacado).toBe(true));

    // El comensal lo ve marcado, en el mismo lugar de la carta.
    const categoria = (await menuPublico()).find((c) => c.id === categoriaId);
    expect(categoria?.items.find((i) => i.id === itemPedidoId)?.destacado).toBe(
      true,
    );
    expect(await ordenDeLaCategoria()).toEqual(ordenAntes);

    // La auditoría tiene el cambio con antes y después.
    const auditoria = await tenantPrisma.runInTenantContext(TENANT_ID, (tx) =>
      tx.registroAuditoria.findMany({
        where: { accion: 'CARTA_ITEM_MODIFICADO', entidadId: itemPedidoId },
        select: { valoresAntes: true, valoresDespues: true },
      }),
    );
    expect(auditoria).toContainEqual({
      valoresAntes: { destacado: false },
      valoresDespues: { destacado: true },
    });

    // Se desmarca y el comensal deja de verlo.
    await conToken(
      tokenAdmin,
      servidor().patch(`/admin/menu/item/${itemPedidoId}`),
    )
      .send({ destacado: false })
      .expect(HttpStatus.OK);
    const despues = (await menuPublico()).find((c) => c.id === categoriaId);
    expect(despues?.items.find((i) => i.id === itemPedidoId)?.destacado).toBe(
      false,
    );
  });

  itConMozo(
    '[TC-I-222] Carta: el MOZO no puede marcar ni desmarcar la «Sugerencia del local» (403)',
    async () => {
      const token = await getToken(MOZO_USER as string, MOZO_PASS as string);
      await conToken(
        token,
        servidor().patch(`/admin/menu/item/${itemPedidoId}`),
      )
        .send({ destacado: true })
        .expect(HttpStatus.FORBIDDEN);
    },
  );

  // ── Aislamiento entre tenants (RLS) ───────────────────────────────────────
  itConTenantB(
    '[TC-I-131] Carta: el admin de otro tenant no ve ni modifica la carta (404)',
    async () => {
      const token = await getToken(
        TENANT_B_USER as string,
        TENANT_B_PASS as string,
      );

      // Aunque pida el restaurante de A, la RLS no le devuelve nada de A.
      const carta = await leerCarta(token);
      expect(carta.map((c) => c.id)).not.toContain(categoriaId);

      const ajenos: request.Test[] = [
        servidor()
          .patch(`/admin/menu/categoria/${categoriaId}`)
          .send({ nombre: 'Ajena' }),
        servidor().post(`/admin/menu/categoria/${categoriaId}/archivar`),
        servidor().delete(`/admin/menu/categoria/${categoriaId}`),
        servidor()
          .put(`/admin/menu/categoria/${categoriaId}/orden`)
          .send({ ids: [itemPedidoId] }),
        servidor()
          .patch(`/admin/menu/item/${itemPedidoId}/disponibilidad`)
          .send({ disponible: false }),
        servidor().post(`/admin/menu/item/${itemPedidoId}/archivar`),
      ];
      for (const prueba of ajenos) {
        await conToken(token, prueba).expect(HttpStatus.NOT_FOUND);
      }
    },
  );
});
