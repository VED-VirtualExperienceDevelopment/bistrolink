#!/usr/bin/env node
/**
 * BL-177: carga en Kiwi TCMS los casos de integración (TC-I) que están en el
 * código y faltan en el Test Plan «Integration tests», y avisa los que tienen
 * un título distinto al del código.
 *
 * Por qué: el plugin de JUnit de Kiwi busca cada test por su título exacto
 * (Summary). Si no lo encuentra, crea un caso nuevo solo con el título. Con
 * todos los casos cargados antes, la primera corrida del pipeline registra
 * los resultados en los casos completos y no crea duplicados.
 *
 * Uso (desde la raíz del repo, con Node 22):
 *
 *   $env:KIWI_TCMS_URL = "https://<instancia>"     # sin /json-rpc/ al final
 *   $env:KIWI_TCMS_USERNAME = "<usuario>"
 *   $env:KIWI_TCMS_PASSWORD = "<contraseña>"
 *   node scripts/kiwi/cargar-casos-integracion.mjs            # solo muestra
 *   node scripts/kiwi/cargar-casos-integracion.mjs --aplicar  # carga
 *   node scripts/kiwi/cargar-casos-integracion.mjs --descripciones            # muestra
 *   node scripts/kiwi/cargar-casos-integracion.mjs --aplicar --descripciones  # carga
 *
 * Sin --aplicar no cambia nada en Kiwi: lista qué casos ya están, cuáles se
 * crearían y cuáles tienen otro título. Con --aplicar:
 * - crea los que faltan (Status CONFIRMED, Automated, Script, Requirement,
 *   Category, Priority, Component y Tags de la tabla de abajo) y los agrega
 *   al plan;
 * - corrige el título de los que existen con el mismo TC-I y otro texto.
 *
 * Con --descripciones, además, compara la descripción de cada caso que tenga
 * un bloque `## TC-I-NNN` en descripciones-integracion.md (al lado de este
 * script) y, con --aplicar, reemplaza las que cambiaron. Los casos que no
 * están en ese archivo no se tocan.
 *
 * BL-435: con --e2e hace lo mismo con los E2E de Playwright (TC-E, en los
 * .spec.ts de e2e/ y sus subcarpetas), contra el Test Plan «E2E-Playwright»
 * y con las descripciones de descripciones-e2e.md:
 *
 *   node scripts/kiwi/cargar-casos-integracion.mjs --e2e --descripciones
 *   node scripts/kiwi/cargar-casos-integracion.mjs --e2e --aplicar --descripciones
 *
 * Con --contrato, lo mismo con los contratos PactJS (TC-C, en los
 * .pact.spec.ts de apps/backend/test/contract), contra el Test Plan
 * «Contract-PactJS» y con descripciones-contrato.md (ver el README de esa
 * carpeta):
 *
 *   node scripts/kiwi/cargar-casos-integracion.mjs --contrato --descripciones
 *   node scripts/kiwi/cargar-casos-integracion.mjs --contrato --aplicar --descripciones
 *
 * En todos los modos, con --aplicar también pasa a CONFIRMED los casos del
 * código que en Kiwi siguen en otro estado (PROPOSED): se corre después de
 * una corrida en verde.
 *
 * Se puede correr las veces que haga falta: lo que ya está igual no se toca.
 * Las credenciales salen de variables de entorno, nunca del repositorio.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APLICAR = process.argv.includes("--aplicar");
const DESCRIPCIONES = process.argv.includes("--descripciones");
const E2E = process.argv.includes("--e2e");
const CONTRATO = process.argv.includes("--contrato");
if (E2E && CONTRATO) {
  console.error("Usá --e2e o --contrato, no los dos.");
  process.exit(1);
}

/**
 * Qué se carga: los tests de integración (por defecto), con --e2e los E2E
 * de Playwright (BL-435) y con --contrato los contratos PactJS. Cada tipo
 * tiene su prefijo, su carpeta, su Test Plan y su archivo de descripciones.
 */
// -t de Jest y -g de Playwright son expresiones regulares: se escapan los
// signos del título.
const comoRegex = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CONFIG_CONTRATO = {
  prefijo: "TC-C",
  directorio: "apps/backend/test/contract",
  esSpec: (archivo) => archivo.endsWith(".pact.spec.ts"),
  plan: "Contract-PactJS",
  descripciones: "descripciones-contrato.md",
  // Corre solo ese contrato (sin la línea: cambia con cualquier edición).
  comando: (_archivo, titulo) =>
    `npm run test:pact --workspace=backend -- -t '${comoRegex(sinPrefijo(titulo))}'`,
};
const TIPO = CONTRATO
  ? CONFIG_CONTRATO
  : E2E
    ? {
        prefijo: "TC-E",
        directorio: "e2e",
        // Recursivo: los specs van por carpeta de dominio (e2e/comensal/...).
        // support/ no tiene specs.
        esSpec: (archivo) => archivo.endsWith(".spec.ts"),
        plan: "E2E-Playwright",
        descripciones: "descripciones-e2e.md",
        // Mismo formato que TC-E-001 a 016: el comando que corre solo ese
        // test, con la ruta sin la línea (cambia con cualquier edición) y -g
        // con el título sin el prefijo (es una expresión regular: se escapan
        // los signos).
        comando: (archivo, titulo) =>
          `npx playwright test e2e/${archivo.replace(/:\d+$/, "")} -g '${comoRegex(sinPrefijo(titulo))}'`,
      }
    : {
        prefijo: "TC-I",
        directorio: "apps/backend/test/integration",
        esSpec: (archivo) =>
          archivo.endsWith(".e2e-spec.ts") && !archivo.includes("/"),
        plan: "Integration tests",
        descripciones: "descripciones-integracion.md",
        comando: (archivo) => archivo,
      };
const DIRECTORIO_TESTS = TIPO.directorio;
const NOMBRE_PLAN = TIPO.plan;
const ARCHIVO_DESCRIPCIONES = join(
  dirname(fileURLToPath(import.meta.url)),
  TIPO.descripciones,
);

/**
 * Datos de cada caso nuevo, con los criterios de
 * Mapeo-Test-Cases-Kiwi-TCMS-Integracion.md (Category, Priority P1 a P3,
 * Component y Tags). Un TC-I del código que no esté acá y falte en Kiwi se
 * crea con DATOS_POR_DEFECTO y se avisa, para completarlo a mano.
 */
const usuarios = (ticket, extra = {}) => ({
  component: "keycloak",
  requirement: "HU-013",
  ...extra,
  tags: ["HU-013", ticket, ...(extra.tags ?? [])],
});
const sesionMesa = (extra = {}) => ({
  component: "mesas",
  requirement: "HU-017",
  ...extra,
  tags: ["HU-017", "BL-60", ...(extra.tags ?? [])],
});
// BL-416: gestión de establecimientos por la plataforma (BL-404).
const plataforma = (ticket, extra = {}) => ({
  component: "plataforma",
  requirement: "BL-404",
  ...extra,
  tags: ["BL-404", ticket, ...(extra.tags ?? [])],
});
const pagosPendientes = (extra = {}) => ({
  component: "api",
  requirement: "HU-032",
  ...extra,
  tags: ["HU-032", "BL-202", "pagos", ...(extra.tags ?? [])],
});
// BL-435: CRUD de la carta (BL-52/BL-53, HU-005), en menu-admin.e2e-spec.ts.
// HU-035 (BL-205): registro de auditoría.
const auditoria = (extra = {}) => ({
  component: "api",
  requirement: "HU-035",
  ...extra,
  tags: ["HU-035", "BL-205", "auditoria", ...(extra.tags ?? [])],
});
// HU-031 (BL-201): cobro en efectivo.
const cobroEfectivo = (extra = {}) => ({
  component: "api",
  requirement: "HU-031",
  ...extra,
  tags: ["HU-031", "BL-201", "pagos", ...(extra.tags ?? [])],
});
// HU-031b (BL-442): el comensal de una mesa pide pagar en efectivo.
const solicitudEfectivo = (extra = {}) => ({
  component: "api",
  requirement: "HU-031b",
  ...extra,
  tags: ["HU-031b", "BL-442", "pagos", ...(extra.tags ?? [])],
});
const cartaAdmin = (extra = {}) => ({
  component: "api",
  requirement: "HU-005",
  ...extra,
  tags: ["HU-005", "BL-52", ...(extra.tags ?? [])],
});
const DATOS_INTEGRACION = {
  55: {
    category: "Funcional",
    priority: "P2",
    component: "api",
    requirement: "HU-034",
    tags: ["HU-034", "BL-204"],
  },
  56: {
    category: "Seguridad",
    priority: "P1",
    component: "api",
    requirement: "HU-034",
    tags: ["HU-034", "BL-204", "seguridad"],
  },
  57: usuarios("BL-358", { category: "Funcional", priority: "P2" }),
  58: usuarios("BL-358", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  59: usuarios("BL-359", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  60: usuarios("BL-359", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  61: usuarios("BL-359", { category: "Funcional", priority: "P3" }),
  62: usuarios("BL-361", { category: "Funcional", priority: "P2" }),
  63: usuarios("BL-362", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  64: usuarios("BL-362", { category: "Funcional", priority: "P2" }),
  65: usuarios("BL-362", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  66: usuarios("BL-366", { category: "Funcional", priority: "P2" }),
  67: usuarios("BL-366", {
    category: "Funcional",
    priority: "P3",
    tags: ["integridad-datos"],
  }),
  68: usuarios("BL-366", { category: "Funcional", priority: "P3" }),
  69: usuarios("BL-367", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  70: usuarios("BL-367", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  71: usuarios("BL-368", { category: "Funcional", priority: "P3" }),
  72: usuarios("BL-369", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  73: usuarios("BL-369", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  74: usuarios("BL-382", { category: "Funcional", priority: "P2" }),
  75: usuarios("BL-382", {
    category: "Funcional",
    priority: "P1",
    tags: ["integridad-datos"],
  }),
  76: usuarios("BL-382", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  77: {
    category: "Seguridad",
    priority: "P1",
    component: "api",
    requirement: "BL-385",
    tags: ["BL-385", "seguridad"],
  },
  78: {
    category: "Seguridad",
    priority: "P1",
    component: "api",
    requirement: "BL-385",
    tags: ["BL-385", "seguridad"],
  },
  79: {
    category: "Seguridad",
    priority: "P1",
    component: "api",
    requirement: "BL-385",
    tags: ["BL-385", "seguridad"],
  },
  80: {
    category: "Seguridad",
    priority: "P1",
    component: "api",
    requirement: "BL-385",
    tags: ["BL-385", "seguridad", "multi-tenant"],
  },
  81: {
    category: "Seguridad",
    priority: "P2",
    component: "api",
    requirement: "BL-385",
    tags: ["BL-385", "seguridad"],
  },
  82: sesionMesa({ category: "Funcional", priority: "P2" }),
  83: sesionMesa({ category: "Performance", priority: "P1" }),
  84: sesionMesa({
    category: "Funcional",
    priority: "P1",
    tags: ["integridad-datos"],
  }),
  85: sesionMesa({
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "integridad-datos"],
  }),
  86: sesionMesa({
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  87: plataforma("BL-416", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  88: plataforma("BL-409", {
    category: "Funcional",
    priority: "P2",
    tags: ["integridad-datos"],
  }),
  89: plataforma("BL-411", { category: "Funcional", priority: "P2" }),
  90: plataforma("BL-413", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  91: plataforma("BL-414", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  92: plataforma("BL-414", {
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  93: plataforma("BL-418", {
    category: "Funcional",
    priority: "P1",
    tags: ["integridad-datos"],
  }),
  94: plataforma("BL-418", {
    category: "Funcional",
    priority: "P1",
    tags: ["integridad-datos", "seguridad"],
  }),
  95: pagosPendientes({ category: "Funcional", priority: "P1" }),
  96: pagosPendientes({
    category: "Funcional",
    priority: "P1",
    tags: ["idempotencia"],
  }),
  97: pagosPendientes({
    category: "Funcional",
    priority: "P2",
    tags: ["integridad-datos"],
  }),
  98: pagosPendientes({
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  99: cartaAdmin({ category: "Funcional", priority: "P2" }),
  100: cartaAdmin({ category: "Funcional", priority: "P2" }),
  101: cartaAdmin({ category: "Funcional", priority: "P2" }),
  102: cartaAdmin({
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  103: cartaAdmin({
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  104: cartaAdmin({
    category: "Seguridad",
    priority: "P1",
    tags: ["BL-53", "seguridad"],
  }),
  105: cartaAdmin({
    category: "Seguridad",
    priority: "P1",
    tags: ["BL-53", "seguridad"],
  }),
  106: cartaAdmin({
    category: "Funcional",
    priority: "P1",
    tags: ["BL-53", "integridad-datos"],
  }),
  107: cartaAdmin({
    category: "Funcional",
    priority: "P1",
    tags: ["BL-53", "integridad-datos"],
  }),
  108: cartaAdmin({ category: "Performance", priority: "P2" }),
  109: auditoria({ category: "Funcional", priority: "P1" }),
  110: auditoria({
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "integridad-datos"],
  }),
  111: auditoria({
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "multi-tenant"],
  }),
  112: auditoria({
    category: "Seguridad",
    priority: "P2",
    tags: ["seguridad"],
  }),
  113: cobroEfectivo({ category: "Funcional", priority: "P1" }),
  114: cobroEfectivo({
    category: "Funcional",
    priority: "P1",
    tags: ["idempotencia"],
  }),
  115: cobroEfectivo({
    category: "Funcional",
    priority: "P1",
    tags: ["concurrencia", "integridad-datos"],
  }),
  116: cobroEfectivo({ category: "Funcional", priority: "P2" }),
  117: cobroEfectivo({
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad"],
  }),
  118: solicitudEfectivo({ category: "Funcional", priority: "P1" }),
  119: solicitudEfectivo({
    category: "Funcional",
    priority: "P1",
    tags: ["integridad-datos"],
  }),
  120: solicitudEfectivo({ category: "Funcional", priority: "P2" }),
  121: solicitudEfectivo({
    category: "Seguridad",
    priority: "P1",
    tags: ["seguridad", "qr"],
  }),
};
/**
 * BL-435: datos de los E2E TC-E-017 en adelante, con los criterios de
 * Mapeo-Test-Cases-Kiwi-TCMS-E2E.md: Requirement con la HU (o el ticket
 * principal si no tiene HU), Component por la pantalla o el actor que
 * prueba, Category `Accesibilidad` para los de axe, tags en minúscula salvo
 * HU-XXX y BL-XXX. TC-E-001 a 016 ya estaban cargados a mano.
 */
const e2e = (component, requirement, extra = {}) => ({
  component,
  requirement,
  ...extra,
  tags: [requirement, "e2e", ...(extra.tags ?? [])],
});
const axe = ["axe-core", "wcag2aa"];
const DATOS_E2E = {
  17: e2e("comensal", "HU-003", {
    category: "Funcional",
    priority: "P1",
    tags: ["BL-309", "BL-311"],
  }),
  18: e2e("kds", "HU-003", {
    category: "Funcional",
    priority: "P1",
    tags: ["BL-309", "BL-204"],
  }),
  19: e2e("comensal", "HU-034", {
    category: "Seguridad",
    priority: "P2",
    tags: ["BL-204", "seguridad"],
  }),
  20: e2e("mesas", "HU-028", {
    category: "Funcional",
    priority: "P1",
    tags: ["BL-173", "integridad-datos"],
  }),
  21: e2e("mesas", "HU-028", {
    category: "Seguridad",
    priority: "P2",
    tags: ["BL-173", "seguridad"],
  }),
  22: e2e("mesas", "HU-028", {
    category: "Accesibilidad",
    priority: "P2",
    tags: ["BL-330", ...axe],
  }),
  23: e2e("keycloak", "BL-342", {
    category: "Accesibilidad",
    priority: "P2",
    tags: ["BL-351", "cross-browser", ...axe],
  }),
  24: e2e("keycloak", "BL-342", {
    category: "Accesibilidad",
    priority: "P2",
    tags: ["BL-345", "cross-browser", ...axe],
  }),
  25: e2e("keycloak", "BL-342", {
    category: "Funcional",
    priority: "P3",
    tags: ["BL-351", "teclado"],
  }),
  26: e2e("keycloak", "BL-342", { category: "Funcional", priority: "P3" }),
  27: e2e("comensal", "BL-352", {
    category: "Funcional",
    priority: "P2",
    tags: ["cross-browser"],
  }),
  28: e2e("comensal", "BL-352", {
    category: "Funcional",
    priority: "P2",
    tags: ["cross-browser", "responsive"],
  }),
  29: e2e("comensal", "BL-352", {
    category: "Funcional",
    priority: "P3",
    tags: ["cross-browser", "responsive"],
  }),
  30: e2e("comensal", "BL-352", {
    category: "Accesibilidad",
    priority: "P2",
    tags: ["cross-browser", ...axe],
  }),
  31: e2e("keycloak", "HU-013", {
    category: "Funcional",
    priority: "P2",
    tags: ["BL-358"],
  }),
  32: e2e("keycloak", "HU-013", {
    category: "Seguridad",
    priority: "P1",
    tags: ["BL-359", "seguridad"],
  }),
  33: e2e("keycloak", "HU-013", {
    category: "Funcional",
    priority: "P2",
    tags: ["BL-362", "BL-366"],
  }),
  34: e2e("keycloak", "HU-013", {
    category: "Funcional",
    priority: "P2",
    tags: ["BL-361"],
  }),
  35: e2e("keycloak", "HU-013", {
    category: "Seguridad",
    priority: "P1",
    tags: ["BL-367", "seguridad"],
  }),
  36: e2e("keycloak", "HU-013", {
    category: "Seguridad",
    priority: "P1",
    tags: ["BL-369", "seguridad"],
  }),
  37: e2e("keycloak", "HU-013", {
    category: "Funcional",
    priority: "P1",
    tags: ["BL-382", "integridad-datos"],
  }),
  38: e2e("keycloak", "HU-013", {
    category: "Accesibilidad",
    priority: "P2",
    tags: ["BL-357", ...axe],
  }),
  39: e2e("comensal", "HU-007", {
    category: "Funcional",
    priority: "P1",
    tags: ["BL-311", "pagos", "integridad-datos"],
  }),
  // Gestión de establecimientos (BL-404, HU-041).
  40: e2e("plataforma", "HU-041", {
    category: "Funcional",
    priority: "P2",
    tags: ["BL-404", "BL-406"],
  }),
  41: e2e("plataforma", "HU-041", {
    category: "Funcional",
    priority: "P2",
    tags: ["BL-404", "BL-411"],
  }),
  42: e2e("plataforma", "HU-041", {
    category: "Funcional",
    priority: "P2",
    tags: ["BL-404", "BL-412"],
  }),
  43: e2e("plataforma", "HU-041", {
    category: "Funcional",
    priority: "P1",
    tags: ["BL-404", "BL-413"],
  }),
  44: e2e("plataforma", "HU-041", {
    category: "Accesibilidad",
    priority: "P1",
    tags: ["BL-404", "BL-416", "responsive", ...axe],
  }),
  45: e2e("plataforma", "HU-041", {
    category: "Funcional",
    priority: "P1",
    tags: ["BL-404", "BL-418", "integridad-datos"],
  }),
  46: e2e("mozo", "HU-031", {
    category: "Funcional",
    priority: "P1",
    tags: ["BL-201", "pagos"],
  }),
  47: e2e("comensal", "HU-031b", {
    category: "Funcional",
    priority: "P1",
    tags: ["BL-442", "pagos"],
  }),
  48: e2e("comensal", "HU-031b", {
    category: "Funcional",
    priority: "P2",
    tags: ["BL-442", "pagos"],
  }),
};
/**
 * Datos de los contratos PactJS (TC-C). Requirement con la HU que usa el
 * endpoint; Component `api`; el proveedor como tag (`mercadopago`, después
 * `surtec`, BL-216), así se filtra por proveedor en un solo plan.
 */
const contrato = (requirement, proveedor, extra = {}) => ({
  category: "Funcional",
  component: "api",
  requirement,
  ...extra,
  tags: [requirement, "contrato", proveedor, ...(extra.tags ?? [])],
});
const DATOS_CONTRATO = {
  // Mercado Pago, API Orders (BL-215).
  1: contrato("HU-007", "mercadopago", { priority: "P1", tags: ["BL-215"] }),
  2: contrato("HU-007", "mercadopago", { priority: "P1", tags: ["BL-215"] }),
  3: contrato("HU-007", "mercadopago", { priority: "P2", tags: ["BL-215"] }),
  4: contrato("HU-032", "mercadopago", {
    priority: "P1",
    tags: ["BL-215", "BL-78"],
  }),
  5: contrato("HU-032", "mercadopago", {
    priority: "P2",
    tags: ["BL-215", "BL-78"],
  }),
  6: contrato("HU-032", "mercadopago", {
    priority: "P2",
    tags: ["BL-215", "BL-78"],
  }),
  7: contrato("HU-032", "mercadopago", {
    priority: "P2",
    tags: ["BL-215", "BL-78"],
  }),
  // Mercado Pago, notificación de webhook (BL-215).
  8: contrato("HU-032", "mercadopago", {
    priority: "P1",
    tags: ["BL-215", "BL-78", "webhook"],
  }),
  9: contrato("HU-032", "mercadopago", {
    priority: "P1",
    tags: ["BL-215", "BL-78", "webhook"],
  }),
};
const DATOS = CONTRATO ? DATOS_CONTRATO : E2E ? DATOS_E2E : DATOS_INTEGRACION;

const DATOS_POR_DEFECTO = {
  category: "Funcional",
  priority: "P3",
  component: null,
  requirement: "",
  tags: [],
};

// ── Casos del código ─────────────────────────────────────────────────────────

/** Títulos `[TC-I-NNN] ...` de los it() y test(), con su archivo y línea. */
function casosDelCodigo() {
  // Un literal entre comillas simples, dobles o backticks que empieza con
  // [TC-I-NNN]. Cada alternativa admite las otras comillas adentro (hay
  // títulos con "En preparación").
  const p = TIPO.prefijo;
  const patron = new RegExp(
    `'(\\[${p}-(\\d{3})\\][^'\\n]*)'|"(\\[${p}-(\\d{3})\\][^"\\n]*)"|\`(\\[${p}-(\\d{3})\\][^\`\\n]*)\``,
    "g",
  );
  const casos = new Map();
  const archivos = readdirSync(DIRECTORIO_TESTS, { recursive: true })
    .map((a) => String(a).replaceAll("\\", "/"))
    .filter(TIPO.esSpec)
    .sort();
  for (const archivo of archivos) {
    const fuente = readFileSync(join(DIRECTORIO_TESTS, archivo), "utf8");
    for (const m of fuente.matchAll(patron)) {
      const titulo = m[1] ?? m[3] ?? m[5];
      const numero = Number(m[2] ?? m[4] ?? m[6]);
      const linea = fuente.slice(0, m.index).split("\n").length;
      if (casos.has(numero)) {
        throw new Error(
          `${p}-${String(numero).padStart(3, "0")} está repetido en el código (${casos.get(numero).script} y ${archivo}:${linea})`,
        );
      }
      casos.set(numero, { numero, titulo, script: `${archivo}:${linea}` });
    }
  }
  return [...casos.values()].sort((a, b) => a.numero - b.numero);
}

/**
 * Bloques `## TC-I-NNN` de descripciones-integracion.md: número → texto.
 * Lo que está antes del primer bloque es la explicación del archivo.
 */
function descripcionesDelArchivo() {
  const partes = readFileSync(ARCHIVO_DESCRIPCIONES, "utf8")
    .replaceAll("\r\n", "\n")
    .split(new RegExp(`^## ${TIPO.prefijo}-(\\d{3})[ \\t]*$`, "m"));
  const descripciones = new Map();
  for (let i = 1; i < partes.length; i += 2) {
    descripciones.set(Number(partes[i]), partes[i + 1].trim());
  }
  return descripciones;
}

// ── Kiwi (JSON-RPC) ──────────────────────────────────────────────────────────

function variable(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`Falta la variable de entorno ${nombre}.`);
    process.exit(1);
  }
  return valor;
}

const URL_RPC = `${variable("KIWI_TCMS_URL").replace(/\/+$/, "")}/json-rpc/`;
let sesion = null;
let idPedido = 0;

async function rpc(metodo, parametros = []) {
  const res = await fetch(URL_RPC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sesion ? { Cookie: `sessionid=${sesion}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: metodo,
      params: parametros,
      id: ++idPedido,
    }),
  });
  if (!res.ok) {
    throw new Error(`${metodo}: HTTP ${res.status}`);
  }
  const cuerpo = await res.json();
  if (cuerpo.error) {
    throw new Error(
      `${metodo}: ${cuerpo.error.message ?? JSON.stringify(cuerpo.error)}`,
    );
  }
  return cuerpo.result;
}

async function unico(metodo, filtro, descripcion) {
  const encontrados = await rpc(metodo, [filtro]);
  if (encontrados.length !== 1) {
    throw new Error(
      `Se esperaba un solo ${descripcion} y hay ${encontrados.length} (${JSON.stringify(filtro)})`,
    );
  }
  return encontrados[0];
}

const numeroDe = (summary) => {
  const m = new RegExp(`^\\[${TIPO.prefijo}-(\\d{3})\\]`).exec(summary ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * Kiwi devuelve el título con las comillas y los signos < > & escapados
 * (&quot;, &lt;…). Para comparar se usa el texto sin escapar.
 */
const sinEscapar = (texto) =>
  (texto ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/**
 * Títulos que Kiwi guarda escapados: el plugin de JUnit los busca con el
 * texto original, no los encuentra y crea un caso nuevo en cada corrida.
 * En el código se usan «» y palabras («menos de 1 s») en su lugar.
 */
const CARACTERES_ESCAPADOS = /["'<>&]/;

const textoNormalizado = (texto) =>
  sinEscapar(texto).replaceAll("\r\n", "\n").trim();

const sinPrefijo = (titulo) =>
  (titulo ?? "")
    .replace(new RegExp(`^\\[${TIPO.prefijo}-\\d{3}\\]\\s*`), "")
    .trim();

// ── Principal ────────────────────────────────────────────────────────────────

async function main() {
  const casos = casosDelCodigo();
  console.log(
    `Código: ${casos.length} casos ${TIPO.prefijo} en ${DIRECTORIO_TESTS}.`,
  );

  const conEscapados = casos.filter((c) => CARACTERES_ESCAPADOS.test(c.titulo));
  if (conEscapados.length > 0) {
    console.error(
      "\nEstos títulos tienen comillas o < > &. Kiwi los guarda escapados y el plugin de JUnit crearía un caso nuevo en cada corrida. Cambialos en el código (por ejemplo, «» en vez de comillas) y volvé a correr el script:",
    );
    for (const c of conEscapados) console.error(`  ${c.titulo}  [${c.script}]`);
    process.exit(1);
  }

  sesion = await rpc("Auth.login", [
    variable("KIWI_TCMS_USERNAME"),
    variable("KIWI_TCMS_PASSWORD"),
  ]);

  const plan = await unico(
    "TestPlan.filter",
    { name: NOMBRE_PLAN },
    "Test Plan",
  );
  console.log(
    `Kiwi: Test Plan «${NOMBRE_PLAN}» (id ${plan.id}, producto ${plan.product__name}).`,
  );

  const enPlan = await rpc("TestCase.filter", [{ plan: plan.id }]);
  // Se busca por el TC-I del principio del título y, si en Kiwi está sin ese
  // prefijo, por el texto. Así un caso cargado sin «[TC-I-NNN] » aparece
  // como «otro título» (se corrige) y no como faltante (se duplicaría).
  const porNumero = new Map();
  const porTexto = new Map();
  for (const caso of enPlan) {
    const numero = numeroDe(caso.summary);
    if (numero === null)
      porTexto.set(sinPrefijo(sinEscapar(caso.summary)), caso);
    else porNumero.set(numero, caso);
  }

  const iguales = [];
  const titulosDistintos = [];
  const faltantes = [];
  for (const caso of casos) {
    const enKiwi =
      porNumero.get(caso.numero) ?? porTexto.get(sinPrefijo(caso.titulo));
    if (!enKiwi) faltantes.push(caso);
    else if (sinEscapar(enKiwi.summary) === caso.titulo) iguales.push(caso);
    else titulosDistintos.push({ ...caso, enKiwi });
  }

  console.log(`\nYa están igual: ${iguales.length}.`);

  console.log(`\nCon otro título en Kiwi: ${titulosDistintos.length}.`);
  for (const c of titulosDistintos) {
    console.log(`  TC-${c.enKiwi.id}`);
    console.log(`    Kiwi:   ${c.enKiwi.summary}`);
    console.log(`    Código: ${c.titulo}`);
  }

  // Casos del código que en Kiwi no están en CONFIRMED (los E2E cargados a
  // mano quedaron en PROPOSED hasta su primera corrida en verde).
  const confirmado = await unico(
    "TestCaseStatus.filter",
    { name: "CONFIRMED" },
    "estado CONFIRMED",
  );
  const sinConfirmar = [...iguales, ...titulosDistintos]
    .map(
      (c) =>
        c.enKiwi ??
        porNumero.get(c.numero) ??
        porTexto.get(sinPrefijo(c.titulo)),
    )
    .filter((caso) => caso.case_status !== confirmado.id);
  console.log(`\nSin CONFIRMED en Kiwi: ${sinConfirmar.length}.`);
  for (const caso of sinConfirmar) {
    console.log(`  TC-${caso.id} ${caso.summary} (${caso.case_status__name})`);
  }

  console.log(`\nFaltan en Kiwi: ${faltantes.length}.`);
  for (const c of faltantes) {
    const sinDatos = DATOS[c.numero]
      ? ""
      : "  (sin datos en el script: completar a mano)";
    console.log(`  ${c.titulo}  [${c.script}]${sinDatos}`);
  }

  if (!APLICAR) {
    if (DESCRIPCIONES) {
      const aCrear = new Set(faltantes.map((c) => c.numero));
      await sincronizarDescripciones(plan.id, false, aCrear);
    }
    console.log(
      "\nNo se cambió nada. Para cargar, volvé a correrlo con --aplicar.",
    );
    return;
  }

  for (const c of titulosDistintos) {
    await rpc("TestCase.update", [c.enKiwi.id, { summary: c.titulo }]);
    console.log(`Título corregido: TC-${c.enKiwi.id} → ${c.titulo}`);
  }

  for (const caso of sinConfirmar) {
    await rpc("TestCase.update", [caso.id, { case_status: confirmado.id }]);
    console.log(`Confirmado: TC-${caso.id}`);
  }

  if (faltantes.length > 0) {
    await crearFaltantes(faltantes, plan.id, plan.product);
  }
  if (DESCRIPCIONES) await sincronizarDescripciones(plan.id, true);
}

/** Crea los casos que faltan y los agrega al plan. */
async function crearFaltantes(faltantes, idPlan, producto) {
  const confirmado = await unico(
    "TestCaseStatus.filter",
    { name: "CONFIRMED" },
    "estado CONFIRMED",
  );
  const categorias = new Map();
  const prioridades = new Map();
  const idCategoria = async (nombre) => {
    if (!categorias.has(nombre)) {
      const c = await unico(
        "Category.filter",
        { name: nombre, product: producto },
        `Category ${nombre}`,
      );
      categorias.set(nombre, c.id);
    }
    return categorias.get(nombre);
  };
  const idPrioridad = async (valor) => {
    if (!prioridades.has(valor)) {
      const p = await unico(
        "Priority.filter",
        { value: valor },
        `Priority ${valor}`,
      );
      prioridades.set(valor, p.id);
    }
    return prioridades.get(valor);
  };

  for (const c of faltantes) {
    const datos = DATOS[c.numero] ?? DATOS_POR_DEFECTO;
    const creado = await rpc("TestCase.create", [
      {
        summary: c.titulo,
        category: await idCategoria(datos.category),
        priority: await idPrioridad(datos.priority),
        case_status: confirmado.id,
        is_automated: true,
        script: TIPO.comando(c.script, c.titulo),
        requirement: datos.requirement,
        text: [
          "### Precondición",
          "Ver el test automatizado.",
          "",
          "### Pasos",
          `Automatizado en \`${DIRECTORIO_TESTS}/${c.script}\`.`,
          "",
          "### Resultado esperado",
          "El test pasa.",
        ].join("\n"),
      },
    ]);
    await rpc("TestPlan.add_case", [idPlan, creado.id]);
    for (const tag of datos.tags) {
      await rpc("TestCase.add_tag", [creado.id, tag]);
    }
    if (datos.component) {
      try {
        await rpc("TestCase.add_component", [creado.id, datos.component]);
      } catch (error) {
        console.warn(
          `  Aviso: no se pudo asignar el componente ${datos.component} a TC-${creado.id}: ${error.message}`,
        );
      }
    }
    console.log(`Creado: TC-${creado.id} ${c.titulo}`);
  }
}

/**
 * Compara la descripción de los casos del plan con descripciones-integracion.md
 * y, si aplicar es true, reemplaza las que cambiaron.
 */
async function sincronizarDescripciones(idPlan, aplicar, aCrear = new Set()) {
  const descripciones = descripcionesDelArchivo();
  const enPlan = await rpc("TestCase.filter", [{ plan: idPlan }]);
  const porNumero = new Map();
  for (const caso of enPlan) {
    const numero = numeroDe(caso.summary);
    if (numero !== null) porNumero.set(numero, caso);
  }

  const cambian = [];
  const sinCaso = [];
  let conCasoNuevo = 0;
  for (const [numero, texto] of descripciones) {
    const caso = porNumero.get(numero);
    if (!caso && aCrear.has(numero)) conCasoNuevo++;
    else if (!caso) sinCaso.push(numero);
    else if (textoNormalizado(caso.text) !== texto)
      cambian.push({ caso, texto });
  }

  console.log(
    `\nDescripciones: ${descripciones.size} en el archivo, ${cambian.length} para actualizar.`,
  );
  if (conCasoNuevo > 0) {
    console.log(
      `  Más ${conCasoNuevo} de casos que faltan: se cargan después de crearlos, en la misma corrida con --aplicar.`,
    );
  }
  for (const { caso } of cambian)
    console.log(`  TC-${caso.id} ${caso.summary}`);
  for (const numero of sinCaso) {
    console.warn(
      `  Aviso: ${TIPO.prefijo}-${String(numero).padStart(3, "0")} tiene descripción en el archivo pero no está en el plan.`,
    );
  }
  if (!aplicar) return;

  for (const { caso, texto } of cambian) {
    await rpc("TestCase.update", [caso.id, { text: texto }]);
    console.log(`Descripción actualizada: TC-${caso.id}`);
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
