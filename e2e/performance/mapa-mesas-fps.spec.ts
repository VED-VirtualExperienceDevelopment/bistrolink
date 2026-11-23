import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../support/auth";

// [TC-P-004] HU-016: el editor del mapa de mesas mantiene al menos 30 FPS al
// arrastrar una mesa con 20 mesas en el plano — valida RD.05
//
// BL-607: la Línea de Base pide el editor del mapa de mesas a ≥ 30 FPS
// (RD.05, HU-016) y mide siempre con 20 usuarios o 20 mesas. Este test:
//   1. crea 20 mesas por la API, con números libres y en una grilla;
//   2. abre /admin/mesas como ADMIN y verifica que el mapa las cargó;
//   3. arrastra una mesa durante 3 s mientras cuenta los frames que dibuja
//      el navegador (requestAnimationFrame) y calcula los FPS;
//   4. borra las 20 mesas en el afterEach, aunque el test falle o se corte
//      por tiempo.
//
// Es de performance, no de la E2E: corre solo en el proyecto «performance»
// de playwright.config.ts, desde performance.yml, y su resultado va al Test
// Plan Performance-k6-Lighthouse de Kiwi. El título de abajo tiene que ser
// idéntico al Summary del caso en Kiwi y al de performance.yml.
//
// ⚠️ Staging es compartido: las mesas se crean con números altos que estén
// libres y nunca se guarda el mapa (el arrastre queda como «Cambios sin
// guardar» y se descarta al cerrar la página).

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const MESAS_PATH = "/admin/mesas";

const CANTIDAD_MESAS = 20;
const FPS_MINIMO = 30;
const DURACION_ARRASTRE_MS = 3000;

// Números de mesa: se toman los libres desde el máximo (99) hacia abajo, para
// no chocar con las mesas del seed (1 y 2).
const NUMERO_MAXIMO = 99;
const INTENTOS_CREAR = 3;

// Grilla de 5 columnas x 4 filas, en unidades del lienzo.
const COLUMNAS = 5;
const MARGEN = 60;
const SEPARACION = 140;
const TAMANO_MESA = 80;

// Mesa que se arrastra: fila 2, columna 3 de la grilla, lejos del borde y
// del rincón (0, 0) donde las crea mesa-temporal.ts.
const INDICE_ARRASTRADA = 7;

// El login de Keycloak, despertar staging, crear 20 mesas, recargar el mapa,
// arrastrar 3 s y borrar no entran en los 30 s por defecto de Playwright:
// al vencerse, el test se cortaba en medio de un pedido a la API.
const TIEMPO_MAXIMO_MS = 120_000;

interface MesaDelLayout {
  id: string;
  numero: number;
}

interface MapaAbierto {
  /** Lo que respondió GET /mesas/layout al cargar la página. */
  mesas: MesaDelLayout[];
  /** Bearer que mandó el frontend, para crear y borrar mesas por API. */
  authorization: string;
  restauranteId: string;
}

/** Mesas creadas por el test, para borrarlas en el afterEach. */
interface MesasParaBorrar {
  authorization: string;
  restauranteId: string;
  ids: string[];
}
let paraBorrar: MesasParaBorrar | null = null;

interface PosicionMesa {
  x: number;
  y: number;
}

/**
 * Abre el mapa y espera a que cargue. Devuelve la respuesta de
 * GET /mesas/layout, el token del ADMIN y el restaurante, igual que
 * abrirMapa() de e2e/admin/plano-salon.spec.ts.
 */
async function abrirMapa(page: Page): Promise<MapaAbierto> {
  const [respuesta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/mesas/layout?") && r.request().method() === "GET",
    ),
    page.goto(MESAS_PATH),
  ]);
  expect(respuesta.status()).toBe(200);
  await expect(page.locator("canvas").first()).toBeVisible();

  return {
    mesas: (await respuesta.json()) as MesaDelLayout[],
    authorization: respuesta.request().headers()["authorization"],
    restauranteId:
      new URL(respuesta.url()).searchParams.get("restauranteId") ?? "",
  };
}

/** Posición de la mesa i en la grilla (unidades del lienzo). */
function posicionEnGrilla(i: number): PosicionMesa {
  return {
    x: MARGEN + (i % COLUMNAS) * SEPARACION,
    y: MARGEN + Math.floor(i / COLUMNAS) * SEPARACION,
  };
}

/**
 * Crea las 20 mesas en un solo POST /mesas/layout (es una transacción: si
 * un número ya existe, responde 409 y no crea ninguna). Si otro test tomó
 * un número en el medio, vuelve a pedir los libres y reintenta.
 */
async function crearMesas(
  request: APIRequestContext,
  authorization: string,
  restauranteId: string,
): Promise<MesaDelLayout[]> {
  let ultimoError = "";
  for (let intento = 1; intento <= INTENTOS_CREAR; intento++) {
    const layout = await request.get(
      `${API_URL}/mesas/layout?restauranteId=${restauranteId}`,
      { headers: { authorization } },
    );
    expect(layout.ok(), `GET /mesas/layout respondió ${layout.status()}`).toBe(
      true,
    );
    const usados = new Set(
      ((await layout.json()) as MesaDelLayout[]).map((m) => m.numero),
    );
    const libres: number[] = [];
    for (let n = NUMERO_MAXIMO; n >= 1 && libres.length < CANTIDAD_MESAS; n--) {
      if (!usados.has(n)) libres.push(n);
    }
    if (libres.length < CANTIDAD_MESAS) {
      throw new Error(
        `El restaurante tiene ${usados.size} mesas: no quedan ${CANTIDAD_MESAS} números libres (máximo ${NUMERO_MAXIMO}).`,
      );
    }

    const crear = await request.post(`${API_URL}/mesas/layout`, {
      headers: { authorization },
      data: {
        restauranteId,
        mesas: libres.map((numero, i) => ({
          numero,
          ...posicionEnGrilla(i),
          forma: "CUADRADO",
          ancho: TAMANO_MESA,
          alto: TAMANO_MESA,
          rotacion: 0,
        })),
      },
    });
    if (crear.status() === 409) {
      ultimoError = await crear.text();
      continue;
    }
    expect(
      crear.ok(),
      `POST /mesas/layout respondió ${crear.status()}: ${await crear.text()}`,
    ).toBe(true);
    return (await crear.json()) as MesaDelLayout[];
  }
  throw new Error(
    `No se pudieron crear las ${CANTIDAD_MESAS} mesas (números ocupados): ${ultimoError}`,
  );
}

/**
 * Centro de la mesa en la pantalla, en píxeles. Se busca su nodo en el
 * Stage de Konva por la posición con la que se creó (Konva queda en
 * window.Konva) y se suma la posición del canvas: así no depende del zoom
 * con el que el editor ajusta el mapa al ancho.
 */
async function centroEnPantalla(
  page: Page,
  posicion: PosicionMesa,
): Promise<PosicionMesa> {
  const canvas = page.locator("canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const caja = await canvas.boundingBox();
  if (!caja) throw new Error("El canvas del mapa no tiene tamaño.");

  const centro = await page.evaluate(({ x, y }) => {
    type Nodo = {
      x(): number;
      y(): number;
      draggable(): boolean;
      getClientRect(): { x: number; y: number; width: number; height: number };
    };
    const konva = (
      window as unknown as {
        Konva?: { stages: { find(selector: string): Nodo[] }[] };
      }
    ).Konva;
    const stage = konva?.stages[0];
    if (!stage) return null;
    const grupo = stage
      .find("Group")
      .find(
        (g) =>
          g.draggable() &&
          Math.abs(g.x() - x) < 0.5 &&
          Math.abs(g.y() - y) < 0.5,
      );
    if (!grupo) return null;
    const r = grupo.getClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, posicion);

  if (!centro) {
    throw new Error(
      `No se encontró en el mapa la mesa creada en (${posicion.x}, ${posicion.y}).`,
    );
  }
  return { x: caja.x + centro.x, y: caja.y + centro.y };
}

/** Empieza a contar los frames que dibuja el navegador. */
async function empezarAContarFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __fps?: { frames: number; inicio: number; fin: number; activo: boolean };
    };
    w.__fps = { frames: 0, inicio: performance.now(), fin: 0, activo: true };
    const contar = () => {
      if (!w.__fps?.activo) return;
      w.__fps.frames++;
      requestAnimationFrame(contar);
    };
    requestAnimationFrame(contar);
  });
}

/** Deja de contar y devuelve los FPS promedio del intervalo. */
async function terminarDeContarFrames(
  page: Page,
): Promise<{ fps: number; frames: number; segundos: number }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __fps: { frames: number; inicio: number; fin: number; activo: boolean };
    };
    w.__fps.activo = false;
    const segundos = (performance.now() - w.__fps.inicio) / 1000;
    return {
      fps: w.__fps.frames / segundos,
      frames: w.__fps.frames,
      segundos,
    };
  });
}

// Borra las mesas del test en un afterEach y no en un finally: si el test se
// corta por tiempo, el finally no llega a terminar, pero Playwright igual
// corre el afterEach. Usa el `request` del test, que no depende de la
// pestaña. Con mesas: [] no toca las demás mesas del restaurante.
test.afterEach(async ({ request }) => {
  if (!paraBorrar) return;
  const { authorization, restauranteId, ids } = paraBorrar;
  paraBorrar = null;
  const borrar = await request.post(`${API_URL}/mesas/layout`, {
    headers: { authorization },
    data: { restauranteId, mesas: [], eliminar: ids },
  });
  expect(
    borrar.ok(),
    `No se pudieron borrar las mesas de prueba: POST /mesas/layout respondió ${borrar.status()}`,
  ).toBe(true);
});

test("[TC-P-004] HU-016: el editor del mapa de mesas mantiene al menos 30 FPS al arrastrar una mesa con 20 mesas en el plano", async ({
  kdsPageAdmin: page,
  request,
}, testInfo) => {
  test.setTimeout(TIEMPO_MAXIMO_MS);
  const { authorization, restauranteId } = await abrirMapa(page);

  const creadas = await crearMesas(request, authorization, restauranteId);
  paraBorrar = {
    authorization,
    restauranteId,
    ids: creadas.map((m) => m.id),
  };
  expect(creadas).toHaveLength(CANTIDAD_MESAS);

  // Recargar: el mapa tiene que traer las 20 mesas nuevas.
  const { mesas } = await abrirMapa(page);
  const enElMapa = new Set(mesas.map((m) => m.id));
  expect(creadas.filter((m) => enElMapa.has(m.id))).toHaveLength(
    CANTIDAD_MESAS,
  );

  const inicio = await centroEnPantalla(
    page,
    posicionEnGrilla(INDICE_ARRASTRADA),
  );

  // Arrastre continuo durante 3 s, en una curva suave hacia abajo y a la
  // derecha (dentro del canvas). Cada movimiento obliga a Konva a volver
  // a dibujar la capa con las 20 mesas.
  await page.mouse.move(inicio.x, inicio.y);
  await page.mouse.down();
  await empezarAContarFrames(page);
  const comienzo = Date.now();
  let paso = 0;
  while (Date.now() - comienzo < DURACION_ARRASTRE_MS) {
    paso++;
    const t = paso / 15;
    await page.mouse.move(
      inicio.x + 60 * (1 - Math.cos(t)),
      inicio.y + 40 * (1 - Math.cos(t / 2)),
    );
  }
  const medicion = await terminarDeContarFrames(page);
  await page.mouse.up();

  // El arrastre se hizo de verdad: el editor marca el cambio sin guardar.
  await expect(page.getByText("Cambios sin guardar")).toBeVisible();

  const resumen = `${medicion.fps.toFixed(1)} FPS (${medicion.frames} frames en ${medicion.segundos.toFixed(2)} s, ${paso} movimientos del mouse, ${CANTIDAD_MESAS} mesas nuevas en el mapa)`;
  testInfo.annotations.push({ type: "fps", description: resumen });
  console.log(`TC-P-004: ${resumen}`);

  expect(
    medicion.fps,
    `El mapa dibujó ${resumen}; el mínimo es ${FPS_MINIMO} FPS (RD.05).`,
  ).toBeGreaterThanOrEqual(FPS_MINIMO);
});
