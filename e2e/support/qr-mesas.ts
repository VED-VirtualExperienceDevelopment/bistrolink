import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { RESTAURANTE_ID } from "./ids";

// HU-034 (BL-204): el menú de una mesa ahora se abre solo desde el QR
// (/q/<token>), y el token no se puede armar desde los tests: es un cifrado
// con QR_TOKEN_KEY, que es un secreto de cada entorno. Los tests le piden
// las URLs al backend (GET /mesas/qr, solo ADMIN), igual que el panel de
// administración para imprimir los QR.
//
// Los tests SOLO leen los QR: nunca los regeneran. Regenerar invalida el QR
// anterior y rompería a los demás tests que corren en paralelo.
//
// HU-017 (BL-60): el QR de una mesa CERRADA no abre la carta («mesa
// cerrada», 410). Por eso, además de leer los QR, el fixture se asegura de
// que las mesas del seed estén abiertas (asegurarMesasAbiertas, BL-432).

const API_URL = process.env.API_URL ?? "http://localhost:3001";

interface RespuestaQrMesas {
  mesas: { id: string; numero: number; url: string }[];
}

export interface QrMesas {
  /** Ruta del menú de la mesa (/q/<token>), para `page.goto`. */
  ruta(mesaId: string): string;
  /** Token opaco del QR de la mesa, para llamar a la API (/menu/qr/<token>). */
  token(mesaId: string): string;
}

/**
 * Con una pestaña ya logueada como ADMIN, toma el Bearer que el frontend
 * manda a la API. No hace falta el client secret de Keycloak: el token es el
 * mismo que usa el panel de administración. Se toma de /admin/mesas, que
 * siempre pide la lista de restaurantes al cargar.
 */
export async function tokenAdminDesdePanel(adminPage: Page): Promise<string> {
  const [request] = await Promise.all([
    adminPage.waitForRequest(
      (req) =>
        req.url().endsWith("/restaurantes") &&
        Boolean(req.headers()["authorization"]),
    ),
    adminPage.goto("/admin/mesas"),
  ]);
  return request.headers()["authorization"];
}

/** Pide las URLs de los QR del restaurante del seed (GET /mesas/qr). */
export async function obtenerQrMesas(
  request: APIRequestContext,
  authorization: string,
): Promise<QrMesas> {
  const res = await request.get(
    `${API_URL}/mesas/qr?restauranteId=${RESTAURANTE_ID}`,
    { headers: { authorization } },
  );
  if (!res.ok()) {
    throw new Error(
      `GET /mesas/qr respondió ${res.status()}: no se pudieron obtener los QR de las mesas.`,
    );
  }

  const { mesas } = (await res.json()) as RespuestaQrMesas;
  // La ruta se toma del pathname: los tests navegan contra BASE_URL, aunque
  // FRONTEND_URL del backend apunte a otro host.
  const rutas = new Map(mesas.map((m) => [m.id, new URL(m.url).pathname]));

  const ruta = (mesaId: string): string => {
    const valor = rutas.get(mesaId);
    if (!valor) {
      throw new Error(`GET /mesas/qr no devolvió la mesa ${mesaId} del seed.`);
    }
    return valor;
  };

  return {
    ruta,
    token: (mesaId) => ruta(mesaId).replace(/^\/q\//, ""),
  };
}

/**
 * HU-017 (BL-60) · BL-432: deja abiertas las mesas que usan los tests, con el
 * mismo token de ADMIN del fixture. Sin esto, si una mesa quedó cerrada en
 * staging (la cerró alguien desde el mapa de mesas, o la migración de BL-60
 * no le dio sesión), su QR muestra «mesa cerrada» y los tests que la usan
 * fallan por timeout.
 *
 * - Si la mesa ya está abierta (409 «ya está abierta») no se toca: abrirla de
 *   nuevo le cambiaría la sesión y rompería a los tests que corren en
 *   paralelo con la sesión actual.
 * - Si requiere limpieza (409), se marca limpia y se abre.
 * - Un 409 después de limpiarla quiere decir que otro worker la abrió al
 *   mismo tiempo: también queda abierta.
 */
export async function asegurarMesasAbiertas(
  request: APIRequestContext,
  authorization: string,
  mesaIds: string[],
): Promise<void> {
  for (const mesaId of mesaIds) {
    const accion = (nombre: "abrir" | "limpia") =>
      request.post(`${API_URL}/mesas/${mesaId}/${nombre}`, {
        headers: { authorization },
      });

    const abrir = await accion("abrir");
    if (abrir.ok()) continue;

    const motivo = await mensajeDeError(abrir);
    if (abrir.status() === 409 && /ya está abierta/i.test(motivo)) continue;

    if (abrir.status() === 409 && /requiere limpieza/i.test(motivo)) {
      const limpia = await accion("limpia");
      if (!limpia.ok() && limpia.status() !== 409) {
        throw new Error(
          `POST /mesas/${mesaId}/limpia respondió ${limpia.status()}: ${await mensajeDeError(limpia)}`,
        );
      }
      const reabrir = await accion("abrir");
      if (reabrir.ok() || reabrir.status() === 409) continue;
      throw new Error(
        `POST /mesas/${mesaId}/abrir respondió ${reabrir.status()}: ${await mensajeDeError(reabrir)}`,
      );
    }

    throw new Error(
      `POST /mesas/${mesaId}/abrir respondió ${abrir.status()}: ${motivo}. No se pudo dejar abierta la mesa del seed.`,
    );
  }
}

/** Mensaje de error de la API (`message`), o el texto crudo si no es JSON. */
async function mensajeDeError(res: APIResponse): Promise<string> {
  const texto = await res.text();
  try {
    const { message } = JSON.parse(texto) as { message?: unknown };
    return typeof message === "string" ? message : texto;
  } catch {
    return texto;
  }
}
