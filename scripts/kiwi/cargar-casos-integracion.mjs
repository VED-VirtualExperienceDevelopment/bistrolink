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
 * Se puede correr las veces que haga falta: lo que ya está igual no se toca.
 * Las credenciales salen de variables de entorno, nunca del repositorio.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIRECTORIO_TESTS = "apps/backend/test/integration";
const NOMBRE_PLAN = "Integration tests";
const APLICAR = process.argv.includes("--aplicar");
const DESCRIPCIONES = process.argv.includes("--descripciones");
const ARCHIVO_DESCRIPCIONES = join(
  dirname(fileURLToPath(import.meta.url)),
  "descripciones-integracion.md",
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
const DATOS = {
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
};
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
  const patron =
    /'(\[TC-I-(\d{3})\][^'\n]*)'|"(\[TC-I-(\d{3})\][^"\n]*)"|`(\[TC-I-(\d{3})\][^`\n]*)`/g;
  const casos = new Map();
  for (const archivo of readdirSync(DIRECTORIO_TESTS).sort()) {
    if (!archivo.endsWith(".e2e-spec.ts")) continue;
    const fuente = readFileSync(join(DIRECTORIO_TESTS, archivo), "utf8");
    for (const m of fuente.matchAll(patron)) {
      const titulo = m[1] ?? m[3] ?? m[5];
      const numero = Number(m[2] ?? m[4] ?? m[6]);
      const linea = fuente.slice(0, m.index).split("\n").length;
      if (casos.has(numero)) {
        throw new Error(
          `TC-I-${String(numero).padStart(3, "0")} está repetido en el código (${casos.get(numero).script} y ${archivo}:${linea})`,
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
    .split(/^## TC-I-(\d{3})[ \t]*$/m);
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
  const m = /^\[TC-I-(\d{3})\]/.exec(summary ?? "");
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
  (titulo ?? "").replace(/^\[TC-I-\d{3}\]\s*/, "").trim();

// ── Principal ────────────────────────────────────────────────────────────────

async function main() {
  const casos = casosDelCodigo();
  console.log(`Código: ${casos.length} casos TC-I en ${DIRECTORIO_TESTS}.`);

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
  console.log(`Kiwi: Test Plan «${NOMBRE_PLAN}» (id ${plan.id}).`);

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

  console.log(`\nFaltan en Kiwi: ${faltantes.length}.`);
  for (const c of faltantes) {
    const sinDatos = DATOS[c.numero]
      ? ""
      : "  (sin datos en el script: completar a mano)";
    console.log(`  ${c.titulo}  [${c.script}]${sinDatos}`);
  }

  if (!APLICAR) {
    if (DESCRIPCIONES) await sincronizarDescripciones(plan.id, false);
    console.log(
      "\nNo se cambió nada. Para cargar, volvé a correrlo con --aplicar.",
    );
    return;
  }

  for (const c of titulosDistintos) {
    await rpc("TestCase.update", [c.enKiwi.id, { summary: c.titulo }]);
    console.log(`Título corregido: TC-${c.enKiwi.id} → ${c.titulo}`);
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
        script: c.script,
        requirement: datos.requirement,
        text: [
          "### Precondición",
          "Ver el test automatizado.",
          "",
          "### Pasos",
          `Automatizado en \`apps/backend/test/integration/${c.script}\`.`,
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
async function sincronizarDescripciones(idPlan, aplicar) {
  const descripciones = descripcionesDelArchivo();
  const enPlan = await rpc("TestCase.filter", [{ plan: idPlan }]);
  const porNumero = new Map();
  for (const caso of enPlan) {
    const numero = numeroDe(caso.summary);
    if (numero !== null) porNumero.set(numero, caso);
  }

  const cambian = [];
  const sinCaso = [];
  for (const [numero, texto] of descripciones) {
    const caso = porNumero.get(numero);
    if (!caso) sinCaso.push(numero);
    else if (textoNormalizado(caso.text) !== texto)
      cambian.push({ caso, texto });
  }

  console.log(
    `\nDescripciones: ${descripciones.size} en el archivo, ${cambian.length} para actualizar.`,
  );
  for (const { caso } of cambian)
    console.log(`  TC-${caso.id} ${caso.summary}`);
  for (const numero of sinCaso) {
    console.warn(
      `  Aviso: TC-I-${String(numero).padStart(3, "0")} tiene descripción en el archivo pero no está en el plan.`,
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
