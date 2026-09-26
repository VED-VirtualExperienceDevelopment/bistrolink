// k6/load-test.js — [TC-P-001] HU-001: performance de /api/menu bajo carga
// (70 sesiones simultáneas, p95 menor a 1.5 s) — valida RNF.05
import http from "k6/http";
import { check, sleep } from "k6";
export const options = {
  vus: 70, duration: "60s",
  tags: { testid: "TC-P-001" },
  thresholds: {
    http_req_duration: ["p(95)<1500"],  // p95 < 1.5 s (RNF.05)
    http_req_failed:   ["rate<0.01"],   // < 1% errores
  },
};
const BASE_URL = __ENV.BASE_URL || "https://staging.bistrolink.app";
export default function () {
  const res = http.get(`${BASE_URL}/api/menu`);
  check(res, { "status 200": (r) => r.status === 200 });
  sleep(1);
}
