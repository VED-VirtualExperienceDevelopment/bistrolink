// k6/load-test.js — [TC-P-001] HU-001: performance de /api/menu bajo carga
// (20 sesiones simultáneas, p95 menor a 1.5s) — valida RNF.05
//
// BL-607: la carga es de 20 sesiones, como todos los objetivos de la Línea
// de Base (OE5: 20 usuarios concurrentes; endpoints críticos con 20
// usuarios). Antes eran 70, un número que no salía de la Línea de Base. El
// umbral no cambia: p95 < 1,5 s y menos de 1 % de errores.
//
// El endpoint real del menú público es
// GET /menu/tenant/:tenantId/restaurante/:restauranteId (HU-002). La ruta
// /api/menu no existe en la API: el test pedía esa URL y recibía 404 en el
// 100 % de los requests. El título del caso conserva «/api/menu» para no
// romper el vínculo con Kiwi TCMS.
import http from "k6/http";
import { check, sleep } from "k6";

// Tenant y restaurante de testing (los mismos de pedidos-carga.js y de la
// URL que mide Lighthouse en TC-P-003).
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const RESTAURANTE_ID = "22222222-2222-2222-2222-222222222222";

export const options = {
  vus: 20,
  duration: "60s",
  tags: { testid: "TC-P-001" },
  thresholds: {
    http_req_duration: ["p(95)<1500"], // p95 < 1.5 s (RNF.05)
    http_req_failed: ["rate<0.01"], // < 1% errores
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";

export default function () {
  const res = http.get(
    `${BASE_URL}/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`,
  );
  check(res, { "status 200": (r) => r.status === 200 });
  sleep(1);
}
