// k6/pedidos-carga.js — [TC-P-002] HU-003: 20 comensales simultáneos
// confirmando pedido, sin timeouts ni 5xx.
//
// HU-034 (BL-204): la mesa solo se puede usar con el token de su QR, que no
// se puede armar desde acá. La carga va por el link web del local (pedido
// para retirar, canal WEB): mismo POST /pedidos, misma transacción, sin
// depender de una URL de QR.
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const RESTAURANTE_ID = "22222222-2222-2222-2222-222222222222";
const ITEM_ID = "55555555-5555-5555-5555-555555555555";

export const options = {
  vus: 20,
  iterations: 20,
  tags: { testid: "TC-P-002" }, 
  thresholds: {
    http_req_failed: ["rate==0"],
  },
};

export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/comensal`,
    JSON.stringify({ tenantId: TENANT_ID, restauranteId: RESTAURANTE_ID }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(res, { "token obtenido": (r) => r.status === 200 });
  return { token: res.json("accessToken") };
}

export default function (data) {
  const idempotencyKey = `carga-${__VU}-${__ITER}-${Date.now()}`;

  const res = http.post(
    `${BASE_URL}/pedidos`,
    JSON.stringify({
      restauranteId: RESTAURANTE_ID,
      idempotencyKey,
      items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.token}`,
      },
    },
  );

  check(res, {
    "pedido creado (201)": (r) => r.status === 201,
    "sin error de servidor": (r) => r.status < 500,
  });
}
