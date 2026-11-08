import type { APIRequestContext, APIResponse } from "@playwright/test";
import { RESTAURANTE_ID } from "./ids";
import { obtenerQrMesas } from "./qr-mesas";

// BL-441: mesa propia de un test, creada y borrada por la API.
//
// Hay tests que agotan el cupo de 1 llamado por minuto de su mesa (o que la
// dejan en un estado particular). En vez de sumar una mesa más al seed, que
// obliga a volver a sembrar cada entorno, el test crea la suya con el
// ADMIN, la usa y la borra al terminar. Así no depende de datos que puedan no
// existir y no choca con otros tests que corren en paralelo.
//
// Solo usa rutas que ya usa el panel de administración:
// POST /mesas/layout (crear y eliminar), POST /mesas/:id/abrir, /cerrar y /limpia.

const API_URL = process.env.API_URL ?? "http://localhost:3001";

// Los números 1 y 2 son de las mesas del seed. Se elige uno al azar entre los
// altos (50 a 99; el máximo es 99) y, si ya existe (409), se prueba otro.
const NUMERO_MINIMO = 50;
const NUMERO_MAXIMO = 99;
const INTENTOS = 5;

export interface MesaTemporal {
  id: string;
  numero: number;
  /** Ruta del menú de la mesa (/q/<token>), para `page.goto`. */
  ruta: string;
}

async function mensaje(res: APIResponse): Promise<string> {
  const texto = await res.text();
  try {
    const { message } = JSON.parse(texto) as { message?: unknown };
    return typeof message === "string" ? message : texto;
  } catch {
    return texto;
  }
}

/**
 * Crea una mesa, la deja abierta (con sesión, para que su QR abra la carta) y
 * devuelve su ruta de QR. `authorization` es el Bearer de un ADMIN.
 */
export async function crearMesaTemporal(
  request: APIRequestContext,
  authorization: string,
): Promise<MesaTemporal> {
  let ultimoError = "";
  for (let intento = 0; intento < INTENTOS; intento++) {
    const numero =
      NUMERO_MINIMO +
      Math.floor(Math.random() * (NUMERO_MAXIMO - NUMERO_MINIMO + 1));
    const crear = await request.post(`${API_URL}/mesas/layout`, {
      headers: { authorization },
      data: {
        restauranteId: RESTAURANTE_ID,
        mesas: [
          {
            numero,
            x: 0,
            y: 0,
            forma: "CUADRADO",
            ancho: 80,
            alto: 80,
            rotacion: 0,
          },
        ],
      },
    });
    if (crear.status() === 409) {
      ultimoError = await mensaje(crear);
      continue;
    }
    if (!crear.ok()) {
      throw new Error(
        `POST /mesas/layout respondió ${crear.status()}: ${await mensaje(crear)}`,
      );
    }
    const [mesa] = (await crear.json()) as { id: string; numero: number }[];

    const abrir = await request.post(`${API_URL}/mesas/${mesa.id}/abrir`, {
      headers: { authorization },
    });
    if (!abrir.ok()) {
      await eliminarMesaTemporal(request, authorization, mesa.id);
      throw new Error(
        `POST /mesas/${mesa.id}/abrir respondió ${abrir.status()}: ${await mensaje(abrir)}`,
      );
    }

    const qr = await obtenerQrMesas(request, authorization);
    return { id: mesa.id, numero: mesa.numero, ruta: qr.ruta(mesa.id) };
  }
  throw new Error(
    `No se pudo crear una mesa de prueba (números ocupados): ${ultimoError}`,
  );
}

/**
 * Cierra la mesa, la marca limpia y la borra. Va en el `finally` del test, así
 * que no tira error: cada paso se intenta aunque el anterior haya fallado (si
 * la mesa ya estaba libre, cerrar responde 409 y se sigue).
 */
export async function eliminarMesaTemporal(
  request: APIRequestContext,
  authorization: string,
  mesaId: string,
): Promise<void> {
  const headers = { authorization };
  await request.post(`${API_URL}/mesas/${mesaId}/cerrar`, { headers });
  await request.post(`${API_URL}/mesas/${mesaId}/limpia`, { headers });
  await request.post(`${API_URL}/mesas/layout`, {
    headers,
    data: { restauranteId: RESTAURANTE_ID, mesas: [], eliminar: [mesaId] },
  });
}
