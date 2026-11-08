import type {
  APIRequestContext,
  BrowserContext,
  Response,
  TestInfo,
} from "@playwright/test";

// BL-477 (BL-285, ADR 0011): cada E2E cierra al terminar los pedidos que
// creó, pase o falle, con POST /testing/limpieza. Reemplaza al cierre a mano
// desde la pantalla (entregar desde el KDS, cobrar en efectivo), que fallaba
// justo cuando el test había fallado antes y dejaba pedidos abiertos en
// staging.
//
// La limpieza cierra, no borra (ADR 0011): sin pagar → CANCELADO, pagado →
// ENTREGADO. Así el pedido sale del KDS, de «Cobros pendientes» y de
// «Alertas».
//
// La ruta solo existe con E2E_CLEANUP_ENABLED=true en el backend. Si no está
// (404), el test no falla: se anota en el reporte y los pedidos quedan
// abiertos, como antes.

const API_URL = process.env.API_URL ?? "http://localhost:3001";

/** Margen antes del vencimiento del token para pedir uno nuevo. */
const MARGEN_TOKEN_MS = 30_000;

/** Respuestas que crean un pedido: carta (comensal) y carga del mozo. */
const RUTAS_QUE_CREAN_PEDIDOS = [/\/pedidos$/, /\/pedidos\/mozo$/];

export interface PedidosDeTest {
  /**
   * Registra un pedido para cerrarlo al terminar. Los que se crean desde una
   * página del `context` del test (POST /pedidos, POST /pedidos/mozo) se
   * registran solos: esto es para los que se crean con `request`.
   */
  registrar(pedidoId: string): void;
  /** Los pedidos registrados hasta ahora. */
  readonly ids: readonly string[];
}

/** Sesión de ADMIN del worker para llamar a la limpieza. */
export interface SesionLimpieza {
  /** Header Authorization vigente («Bearer …»). */
  authorization(): Promise<string>;
}

/** Vencimiento del JWT en ms (claim `exp`). 0 si no se puede leer. */
export function vencimientoDelToken(authorization: string): number {
  const payload = authorization.replace(/^Bearer /, "").split(".")[1];
  if (!payload) return 0;
  try {
    const { exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Si el token sirve todavía, con margen para la llamada. */
export function tokenVigente(
  authorization: string | undefined,
  ahoraMs = Date.now(),
): authorization is string {
  if (!authorization) return false;
  return vencimientoDelToken(authorization) - MARGEN_TOKEN_MS > ahoraMs;
}

/** Id del pedido si la respuesta es la creación de un pedido (201). */
export async function pedidoCreado(res: Response): Promise<string | null> {
  if (res.request().method() !== "POST" || res.status() !== 201) return null;
  const ruta = new URL(res.url()).pathname;
  if (!RUTAS_QUE_CREAN_PEDIDOS.some((patron) => patron.test(ruta))) {
    return null;
  }
  try {
    const { id } = (await res.json()) as { id?: unknown };
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/**
 * Escucha las respuestas del `context` del test y junta los pedidos creados.
 * Devuelve el registro y una función que espera las lecturas en curso.
 */
export function registrarPedidosDelContexto(context: BrowserContext): {
  pedidos: PedidosDeTest;
  terminar: () => Promise<void>;
} {
  const ids = new Set<string>();
  const lecturas: Promise<void>[] = [];
  const alResponder = (res: Response) => {
    lecturas.push(
      pedidoCreado(res).then((id) => {
        if (id) ids.add(id);
      }),
    );
  };
  context.on("response", alResponder);
  return {
    pedidos: {
      registrar: (pedidoId) => ids.add(pedidoId),
      get ids() {
        return [...ids];
      },
    },
    terminar: async () => {
      context.off("response", alResponder);
      await Promise.allSettled(lecturas);
    },
  };
}

/**
 * Cierra los pedidos con POST /testing/limpieza (solo el área pedidos, solo
 * esos ids). Nunca tira: un error de la limpieza no tapa el resultado del
 * test, queda como anotación en el reporte.
 */
export async function cerrarPedidosDeTest(
  request: APIRequestContext,
  sesion: SesionLimpieza,
  pedidoIds: readonly string[],
  testInfo: TestInfo,
): Promise<void> {
  if (pedidoIds.length === 0) return;
  const avisar = (descripcion: string) =>
    testInfo.annotations.push({ type: "limpieza", description: descripcion });

  try {
    const res = await request.post(`${API_URL}/testing/limpieza`, {
      headers: { authorization: await sesion.authorization() },
      data: { areas: ["pedidos"], pedidoIds },
      timeout: 15_000,
    });
    if (res.status() === 404) {
      avisar(
        `La limpieza no está habilitada en ${API_URL} (E2E_CLEANUP_ENABLED): quedaron abiertos ${pedidoIds.join(", ")}.`,
      );
      return;
    }
    if (!res.ok()) {
      avisar(
        `POST /testing/limpieza respondió ${res.status()}: ${await res.text()}`,
      );
    }
  } catch (err) {
    avisar(`No se pudieron cerrar los pedidos: ${(err as Error).message}`);
  }
}
