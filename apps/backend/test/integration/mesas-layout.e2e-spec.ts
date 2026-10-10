import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { MesaEstado, Prisma, PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';

// ── Config de Keycloak (mismo esquema que usuarios.e2e-spec.ts) ─────────────
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

// Admin del tenant A (seed: admin-test).
const ADMIN_USER = process.env.TEST_ADMIN_USERNAME ?? 'admin-test';
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;

// Mozo del tenant A (seed: mozo-test). Mismo fixture que kds.e2e-spec.ts —
// si allá las variables se llaman distinto, alinear estos dos nombres.
const MOZO_USER = process.env.TEST_MOZO_USERNAME ?? 'mozo-test';
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;

// Comensal del tenant A: usuario técnico del realm (keycloak/test-users.json),
// el mismo que usa AuthComensalService (`comensal-${tenantId}`).
const COMENSAL_PASS = process.env.KEYCLOAK_COMENSAL_PASSWORD;

// ── Fixtures del seed (prisma/seed.ts) ──────────────────────────────────────
// Tenant de testing A («Restaurante Testing A»): ahí viven admin-test,
// mozo-test y el comensal técnico (BL-197; antes admin-test estaba en el
// tenant Ejemplo, que se retiró). Ojo: sus IDs (1111…, 2222…, 3333…) no son
// UUID RFC 4122 válidos (el 4to grupo no empieza con 8, 9, a ni b), así que
// un @IsUUID() estricto los rechaza con 400 — ver TC-I-032.
const TENANT_A_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_A_ID = '22222222-2222-2222-2222-222222222222';
const MESA_A1_ID = '33333333-3333-3333-3333-333333333333';
const COMENSAL_USER = `comensal-${TENANT_A_ID}`;

// Tenant B: el "otro tenant" para los casos de aislamiento (TC-I-031/033).
// Sus IDs sí son UUID v4 válidos, así que el rechazo que se mida es por
// aislamiento y no por formato del id.
const TENANT_B_ID = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_B_ID = 'a46faef3-7412-45ae-af80-3829cd27b990';

// Rango de números de mesa reservado para esta suite: todo lo que se cree
// con estos números se borra en afterAll (regla de CRUD real de la guía de
// casos de prueba). No colisiona con las mesas 1 y 2 del seed.
const NUMERO_BASE = 900;
const NUMEROS_TEST = Array.from({ length: 20 }, (_, i) => NUMERO_BASE + i);

const LAYOUT_VALIDO = {
  x: 120.5,
  y: 80,
  forma: 'RECTANGULO',
  ancho: 160,
  alto: 80,
  rotacion: 90,
};

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
    throw new Error(
      `No se pudo obtener token para ${username}: ${res.status} ${await res.text()}`,
    );
  }
  const data = await res.json();
  return data.access_token as string;
}

describe('Mapa de mesas (HU-016) - e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const itConAdmin = ADMIN_PASS ? it : it.skip;
  const itConMozo = MOZO_PASS ? it : it.skip;
  const itConComensal = COMENSAL_PASS ? it : it.skip;

  // Mesa del tenant B creada por la suite (el seed no le carga mesas).
  const NUMERO_MESA_AJENA = NUMERO_BASE + 19;
  let mesaAjenaId: string;

  // Restaurantes que toca la suite. Toda consulta y todo borrado del test
  // filtra explícitamente por estos ids + el rango de números reservado:
  // no se confía en RLS para acotar, porque la conexión directa del test
  // puede no aplicarlo (en la primera corrida vio mesas de otro tenant).
  const RESTAURANTES_SUITE = [RESTAURANTE_A_ID, RESTAURANTE_B_ID];
  const FILTRO_MESAS_TEST = {
    numero: { in: NUMEROS_TEST },
    restauranteId: { in: RESTAURANTES_SUITE },
  };

  // Estado original de la mesa del seed que tocan TC-I-030/032, para
  // restaurarla en afterAll si algún caso (o una regresión) la modificara.
  let mesaA1Original: {
    layout: Prisma.JsonValue;
    estado: MesaEstado;
  } | null = null;

  // Fija app.tenant_id dentro de la transacción, igual que TenantPrismaService,
  // para que las escrituras pasen el WITH CHECK de RLS si está activo.
  async function enTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  async function buscarMesas(
    tenantId: string,
    restauranteId: string,
    numero: number | { in: number[] },
  ) {
    return enTenant(tenantId, (tx) =>
      tx.mesa.findMany({ where: { tenantId, restauranteId, numero } }),
    );
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // main.ts registra el ValidationPipe global con estas opciones, pero
    // createNestApplication() no ejecuta main.ts. Sin esto, este test no
    // estaría probando la validación que corre en producción (TC-I-029).
    // Mantener sincronizado con main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = new PrismaClient();
    // Por si una corrida anterior se cortó antes de su afterAll.
    await limpiarMesasDeTest();

    mesaA1Original = await enTenant(TENANT_A_ID, (tx) =>
      tx.mesa.findUnique({
        where: { id: MESA_A1_ID },
        select: { layout: true, estado: true },
      }),
    );

    const mesaAjena = await enTenant(TENANT_B_ID, (tx) =>
      tx.mesa.create({
        data: {
          tenantId: TENANT_B_ID,
          restauranteId: RESTAURANTE_B_ID,
          numero: NUMERO_MESA_AJENA,
          estado: 'LIBRE',
          layout: {
            x: 10,
            y: 10,
            forma: 'CIRCULO',
            ancho: 80,
            alto: 80,
            rotacion: 0,
          },
        },
      }),
    );
    mesaAjenaId = mesaAjena.id;
  });

  // Borra lo creado con los números reservados en los restaurantes de la
  // suite, desde el contexto de cada tenant (incluida una mesa que TC-I-033
  // pudiera haber creado con tenant A colgada del restaurante B).
  // Primero los pedidos de esas mesas (TC-I-036 crea uno): Pedido.mesaId es
  // FK obligatoria y sin ellos el borrado de la mesa falla.
  // Devuelve cuántas mesas de test quedaron sin borrar.
  async function limpiarMesasDeTest(): Promise<number> {
    const tenants = [TENANT_A_ID, TENANT_B_ID];
    for (const tenantId of tenants) {
      await enTenant(tenantId, async (tx) => {
        await tx.pedido.deleteMany({
          where: { tenantId, mesa: FILTRO_MESAS_TEST },
        });
        return tx.mesa.deleteMany({
          where: { tenantId, ...FILTRO_MESAS_TEST },
        });
      }).catch(() => {
        // Best-effort: se verifica abajo con el conteo final.
      });
    }
    let restantes = 0;
    for (const tenantId of tenants) {
      restantes += await enTenant(tenantId, (tx) =>
        tx.mesa.count({ where: { tenantId, ...FILTRO_MESAS_TEST } }),
      );
    }
    return restantes;
  }

  afterAll(async () => {
    try {
      // Restaura la mesa del seed si algo la hubiera modificado.
      if (mesaA1Original) {
        await enTenant(TENANT_A_ID, (tx) =>
          tx.mesa.update({
            where: { id: MESA_A1_ID },
            data: {
              layout:
                mesaA1Original!.layout === null
                  ? Prisma.DbNull
                  : (mesaA1Original!.layout as Prisma.InputJsonValue),
              estado: mesaA1Original!.estado,
            },
          }),
        );
      }
      const restantes = await limpiarMesasDeTest();
      // Si el cleanup no pudo borrar todo, la suite lo reporta en vez de
      // dejar basura en la base en silencio.
      expect(restantes).toBe(0);
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  itConAdmin(
    '[TC-I-029] HU-016: rechaza un layout con código ejecutable embebido en el JSON',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const guardar = (mesas: unknown[]) =>
        request(app.getHttpServer())
          .post('/mesas/layout')
          .set('Authorization', `Bearer ${token}`)
          .send({ restauranteId: RESTAURANTE_A_ID, mesas });

      // Control positivo: el mismo request con un layout limpio se acepta.
      // Así un 400 más abajo solo puede deberse al contenido inyectado.
      await guardar([{ numero: NUMERO_BASE, ...LAYOUT_VALIDO }]).expect(201);

      const payloadsMaliciosos = [
        // Propiedad extra con un handler JS.
        [
          {
            numero: NUMERO_BASE + 1,
            ...LAYOUT_VALIDO,
            onClick: 'alert(document.cookie)',
          },
        ],
        // Código en un campo numérico.
        [
          {
            numero: NUMERO_BASE + 2,
            ...LAYOUT_VALIDO,
            x: 'function(){ fetch("//evil") }',
          },
        ],
        // Script en el campo de catálogo.
        [
          {
            numero: NUMERO_BASE + 3,
            ...LAYOUT_VALIDO,
            forma: '<script>alert(1)</script>',
          },
        ],
      ];

      for (const mesas of payloadsMaliciosos) {
        await guardar(mesas).expect(400);
      }

      // Ninguno de los rechazados llegó a la base; solo existe el control.
      const creadas = await buscarMesas(TENANT_A_ID, RESTAURANTE_A_ID, {
        in: NUMEROS_TEST,
      });
      expect(creadas.map((m) => m.numero)).toEqual([NUMERO_BASE]);
      expect(creadas[0].layout).toStrictEqual(LAYOUT_VALIDO);
    },
  );

  itConMozo(
    '[TC-I-030] HU-016: Colaborador recibe 403 al intentar modificar el layout vía API',
    async () => {
      const token = await getToken(MOZO_USER, MOZO_PASS as string);
      const antes = await enTenant(TENANT_A_ID, (tx) =>
        tx.mesa.findUnique({ where: { id: MESA_A1_ID } }),
      );

      await request(app.getHttpServer())
        .post('/mesas/layout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          restauranteId: RESTAURANTE_A_ID,
          mesas: [{ id: MESA_A1_ID, numero: 1, ...LAYOUT_VALIDO }],
        })
        .expect(403);

      await request(app.getHttpServer())
        .put(`/mesas/${MESA_A1_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send(LAYOUT_VALIDO)
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/mesas/${MESA_A1_ID}/estado`)
        .set('Authorization', `Bearer ${token}`)
        .send({ estado: 'OCUPADA' })
        .expect(403);

      // Nada cambió en la mesa: ni layout ni estado.
      const despues = await enTenant(TENANT_A_ID, (tx) =>
        tx.mesa.findUnique({ where: { id: MESA_A1_ID } }),
      );
      expect(despues?.layout).toStrictEqual(antes?.layout);
      expect(despues?.estado).toBe(antes?.estado);
    },
  );

  itConAdmin(
    '[TC-I-031] HU-016: un tenant no puede leer ni modificar el layout de otro tenant',
    async () => {
      // admin-test es ADMIN del tenant A: tiene el rol correcto, así que
      // cualquier rechazo acá es por aislamiento, no por permisos.
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const leerMesaAjena = () =>
        enTenant(TENANT_B_ID, (tx) =>
          tx.mesa.findUnique({ where: { id: mesaAjenaId } }),
        );
      const antes = await leerMesaAjena();

      // Lectura: el restaurante B existe y tiene una mesa, pero no es de este tenant.
      const lectura = await request(app.getHttpServer())
        .get('/mesas/layout')
        .query({ restauranteId: RESTAURANTE_B_ID })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(lectura.body).toEqual([]);

      // Escritura masiva sobre la mesa del tenant B.
      await request(app.getHttpServer())
        .post('/mesas/layout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          restauranteId: RESTAURANTE_B_ID,
          mesas: [
            { id: mesaAjenaId, numero: NUMERO_MESA_AJENA, ...LAYOUT_VALIDO },
          ],
        })
        .expect(404);

      // Escritura puntual (PUT /mesas/:id): esta ruta depende solo de RLS.
      await request(app.getHttpServer())
        .put(`/mesas/${mesaAjenaId}`)
        .set('Authorization', `Bearer ${token}`)
        .send(LAYOUT_VALIDO)
        .expect(404);

      const despues = await leerMesaAjena();
      expect(despues?.layout).toStrictEqual(antes?.layout);
    },
  );

  itConMozo(
    '[TC-I-032] HU-016: Colaborador puede visualizar el layout de su restaurante (200)',
    async () => {
      const token = await getToken(MOZO_USER, MOZO_PASS as string);

      const res = await request(app.getHttpServer())
        .get('/mesas/layout')
        .query({ restauranteId: RESTAURANTE_A_ID })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const ids = res.body.map((m: { id: string }) => m.id);
      expect(ids).toContain(MESA_A1_ID);
      for (const mesa of res.body) {
        expect(Object.keys(mesa).sort()).toEqual([
          'estado',
          'id',
          'layout',
          'numero',
        ]);
      }
    },
  );

  itConAdmin(
    '[TC-I-033] HU-016: no permite crear mesas en un restaurante de otro tenant',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      const res = await request(app.getHttpServer())
        .post('/mesas/layout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          restauranteId: RESTAURANTE_B_ID,
          mesas: [{ numero: NUMERO_BASE + 10, ...LAYOUT_VALIDO }],
        });

      expect([403, 404]).toContain(res.status);

      // Ni con el tenant propio ni con el ajeno debe existir la mesa nueva
      // colgada del restaurante B (la mesa ajena de la suite es otro número).
      const conTenantA = await buscarMesas(
        TENANT_A_ID,
        RESTAURANTE_B_ID,
        NUMERO_BASE + 10,
      );
      const conTenantB = await buscarMesas(
        TENANT_B_ID,
        RESTAURANTE_B_ID,
        NUMERO_BASE + 10,
      );
      expect([...conTenantA, ...conTenantB]).toEqual([]);
    },
  );

  // BL-58: el controller tiene @Roles('COMENSAL') a nivel de clase (para
  // POST /mesas/:id/llamar) y @Roles('ADMIN') / @Roles('ADMIN', 'MOZO') en
  // los métodos del mapa. Este caso protege que el rol del método REEMPLACE
  // al de la clase (RolesGuard usa getAllAndOverride): si se sumaran, un
  // comensal podría modificar el layout.
  itConComensal(
    '[TC-I-034] HU-016: un comensal no puede ver ni modificar el layout de mesas (403)',
    async () => {
      const token = await getToken(COMENSAL_USER, COMENSAL_PASS as string);
      const antes = await enTenant(TENANT_A_ID, (tx) =>
        tx.mesa.findUnique({ where: { id: MESA_A1_ID } }),
      );

      // Control positivo: el token es válido y tiene el rol COMENSAL (la ruta
      // de la clase lo acepta). Así un 403 más abajo solo puede deberse al
      // @Roles del método, no a un token inválido o sin rol.
      await request(app.getHttpServer())
        .post(`/mesas/${MESA_A1_ID}/llamar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await request(app.getHttpServer())
        .get('/mesas/layout')
        .query({ restauranteId: RESTAURANTE_A_ID })
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await request(app.getHttpServer())
        .post('/mesas/layout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          restauranteId: RESTAURANTE_A_ID,
          mesas: [{ id: MESA_A1_ID, numero: 1, ...LAYOUT_VALIDO }],
        })
        .expect(403);

      await request(app.getHttpServer())
        .put(`/mesas/${MESA_A1_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send(LAYOUT_VALIDO)
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/mesas/${MESA_A1_ID}/estado`)
        .set('Authorization', `Bearer ${token}`)
        .send({ estado: 'OCUPADA' })
        .expect(403);

      // Nada cambió en la mesa: ni layout ni estado.
      const despues = await enTenant(TENANT_A_ID, (tx) =>
        tx.mesa.findUnique({ where: { id: MESA_A1_ID } }),
      );
      expect(despues?.layout).toStrictEqual(antes?.layout);
      expect(despues?.estado).toBe(antes?.estado);
    },
  );

  // BL-58: "Eliminar mesa" del editor. Las mesas se mandan en `eliminar`
  // dentro del mismo POST /mesas/layout y se borran en la misma transacción.
  itConAdmin(
    '[TC-I-035] HU-016: el administrador elimina del mapa una mesa libre y sin pedidos',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const guardar = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post('/mesas/layout')
          .set('Authorization', `Bearer ${token}`)
          .send({ restauranteId: RESTAURANTE_A_ID, ...body });

      const creadas = await guardar({
        mesas: [
          { numero: NUMERO_BASE + 5, ...LAYOUT_VALIDO },
          { numero: NUMERO_BASE + 6, ...LAYOUT_VALIDO },
        ],
      }).expect(201);
      const idPorNumero = new Map<number, string>(
        creadas.body.map((m: { id: string; numero: number }) => [
          m.numero,
          m.id,
        ]),
      );

      // 1. Guardado con solo eliminaciones (sin mesas): borra la 905.
      await guardar({
        mesas: [],
        eliminar: [idPorNumero.get(NUMERO_BASE + 5)],
      }).expect(201);

      // 2. Borrar la 906 y crear otra 906 en el mismo guardado: se borra
      //    primero, así que el número queda libre para la mesa nueva.
      const reemplazo = await guardar({
        mesas: [{ numero: NUMERO_BASE + 6, ...LAYOUT_VALIDO }],
        eliminar: [idPorNumero.get(NUMERO_BASE + 6)],
      }).expect(201);

      const quedan = await buscarMesas(TENANT_A_ID, RESTAURANTE_A_ID, {
        in: [NUMERO_BASE + 5, NUMERO_BASE + 6],
      });
      expect(quedan.map((m) => m.numero)).toEqual([NUMERO_BASE + 6]);
      expect(quedan[0].id).toBe(reemplazo.body[0].id);
      expect(quedan[0].id).not.toBe(idPorNumero.get(NUMERO_BASE + 6));
    },
  );

  itConAdmin(
    '[TC-I-036] HU-016: no permite eliminar del mapa mesas con pedidos o que no están libres (409)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const guardar = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post('/mesas/layout')
          .set('Authorization', `Bearer ${token}`)
          .send({ restauranteId: RESTAURANTE_A_ID, ...body });

      // Mesa 907: LIBRE con un pedido ya entregado (historial).
      // Mesa 908: OCUPADA, todavía sin pedidos.
      const { conPedido, ocupada } = await enTenant(TENANT_A_ID, async (tx) => {
        const crearMesa = (numero: number, estado: MesaEstado) =>
          tx.mesa.create({
            data: {
              tenantId: TENANT_A_ID,
              restauranteId: RESTAURANTE_A_ID,
              numero,
              estado,
              layout: LAYOUT_VALIDO,
            },
          });
        const mesaConPedido = await crearMesa(NUMERO_BASE + 7, 'LIBRE');
        await tx.pedido.create({
          data: {
            tenantId: TENANT_A_ID,
            restauranteId: RESTAURANTE_A_ID,
            mesaId: mesaConPedido.id,
            idempotencyKey: `tc-i-036-${Date.now()}`,
            estado: 'ENTREGADO',
            canal: 'QR',
          },
        });
        const mesaOcupada = await crearMesa(NUMERO_BASE + 8, 'OCUPADA');
        return { conPedido: mesaConPedido, ocupada: mesaOcupada };
      });

      const conPedidos = await guardar({
        mesas: [],
        eliminar: [conPedido.id],
      }).expect(409);
      expect(conPedidos.body.message).toContain('pedidos registrados');

      const noLibre = await guardar({
        mesas: [],
        eliminar: [ocupada.id],
      }).expect(409);
      expect(noLibre.body.message).toContain('no están libres');

      // Atomicidad: si una eliminación falla, tampoco se crea la mesa nueva
      // que venía en el mismo guardado.
      await guardar({
        mesas: [{ numero: NUMERO_BASE + 9, ...LAYOUT_VALIDO }],
        eliminar: [conPedido.id],
      }).expect(409);

      const quedan = await buscarMesas(TENANT_A_ID, RESTAURANTE_A_ID, {
        in: [NUMERO_BASE + 7, NUMERO_BASE + 8, NUMERO_BASE + 9],
      });
      expect(quedan.map((m) => m.numero).sort((a, b) => a - b)).toEqual([
        NUMERO_BASE + 7,
        NUMERO_BASE + 8,
      ]);
    },
  );
  // BL-58: a diferencia del caso de atomicidad de TC-I-036 (que falla en el
  // chequeo previo, antes de escribir nada), acá el borrado SÍ se ejecuta y lo
  // que falla después es el create. Si la mesa borrada sigue existiendo, es
  // porque Postgres deshizo el DELETE: prueba que guardarLayout corre en una
  // única transacción.
  itConAdmin(
    '[TC-I-037] HU-016: si falla la creación después de eliminar, el borrado se revierte',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      const { aBorrar } = await enTenant(TENANT_A_ID, async (tx) => {
        const crearMesa = (numero: number) =>
          tx.mesa.create({
            data: {
              tenantId: TENANT_A_ID,
              restauranteId: RESTAURANTE_A_ID,
              numero,
              estado: 'LIBRE',
              layout: LAYOUT_VALIDO,
            },
          });
        const mesaABorrar = await crearMesa(NUMERO_BASE + 11);
        // La 912 ya existe: crear otra 912 en el guardado dispara P2002.
        await crearMesa(NUMERO_BASE + 12);
        return { aBorrar: mesaABorrar };
      });

      const res = await request(app.getHttpServer())
        .post('/mesas/layout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          restauranteId: RESTAURANTE_A_ID,
          mesas: [{ numero: NUMERO_BASE + 12, ...LAYOUT_VALIDO }],
          eliminar: [aBorrar.id],
        })
        .expect(409);
      expect(res.body.message).toContain('Ya existe una mesa con el número');

      const sigue = await enTenant(TENANT_A_ID, (tx) =>
        tx.mesa.findUnique({ where: { id: aBorrar.id } }),
      );
      expect(sigue).not.toBeNull();

      const quedan = await buscarMesas(
        TENANT_A_ID,
        RESTAURANTE_A_ID,
        NUMERO_BASE + 12,
      );
      expect(quedan).toHaveLength(1);
    },
  );

  itConAdmin(
    '[TC-I-038] HU-016: un tenant no puede eliminar mesas de otro tenant',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const eliminar = (restauranteId: string) =>
        request(app.getHttpServer())
          .post('/mesas/layout')
          .set('Authorization', `Bearer ${token}`)
          .send({ restauranteId, mesas: [], eliminar: [mesaAjenaId] });

      // Con el restaurante propio: la mesa ajena no se encuentra (RLS + chequeo explícito).
      await eliminar(RESTAURANTE_A_ID).expect(404);
      // Con el restaurante del tenant B: lo frena el chequeo del restaurante.
      await eliminar(RESTAURANTE_B_ID).expect(404);

      const sigue = await enTenant(TENANT_B_ID, (tx) =>
        tx.mesa.findUnique({ where: { id: mesaAjenaId } }),
      );
      expect(sigue).not.toBeNull();
    },
  );

  // El seed ya crea la mesa virtual de HU-003 (número 0), pero el test usa
  // una propia con un número del rango reservado: así no depende del estado
  // de la base y limpiarMesasDeTest la borra al final.
  itConAdmin(
    '[TC-I-039] HU-016: la mesa virtual no se puede eliminar desde el mapa (404)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const mesaVirtual = await enTenant(TENANT_A_ID, (tx) =>
        tx.mesa.create({
          data: {
            tenantId: TENANT_A_ID,
            restauranteId: RESTAURANTE_A_ID,
            numero: NUMERO_BASE + 14,
            esVirtual: true,
            estado: 'LIBRE',
          },
        }),
      );

      await request(app.getHttpServer())
        .post('/mesas/layout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          restauranteId: RESTAURANTE_A_ID,
          mesas: [],
          eliminar: [mesaVirtual.id],
        })
        .expect(404);

      const sigue = await enTenant(TENANT_A_ID, (tx) =>
        tx.mesa.findUnique({ where: { id: mesaVirtual.id } }),
      );
      expect(sigue).not.toBeNull();
    },
  );

  itConAdmin(
    '[TC-I-040] HU-016: rechaza con 400 una mesa que viene para actualizar y eliminar a la vez',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const mesa = await enTenant(TENANT_A_ID, (tx) =>
        tx.mesa.create({
          data: {
            tenantId: TENANT_A_ID,
            restauranteId: RESTAURANTE_A_ID,
            numero: NUMERO_BASE + 13,
            estado: 'LIBRE',
            layout: LAYOUT_VALIDO,
          },
        }),
      );

      await request(app.getHttpServer())
        .post('/mesas/layout')
        .set('Authorization', `Bearer ${token}`)
        .send({
          restauranteId: RESTAURANTE_A_ID,
          mesas: [
            {
              id: mesa.id,
              numero: NUMERO_BASE + 13,
              ...LAYOUT_VALIDO,
              x: 200,
            },
          ],
          eliminar: [mesa.id],
        })
        .expect(400);

      // Ni se borró ni se movió.
      const despues = await enTenant(TENANT_A_ID, (tx) =>
        tx.mesa.findUnique({ where: { id: mesa.id } }),
      );
      expect(despues?.layout).toStrictEqual(LAYOUT_VALIDO);
    },
  );
});
