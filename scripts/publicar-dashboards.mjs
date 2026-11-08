#!/usr/bin/env node
// BL-298: arma el sitio de GitHub Pages con los dos dashboards.
//
// Se corre DESPUÉS de update-dashboard-from-linear.mjs y
// update-github-bugs-dashboard.mjs, que actualizan los bloques AUTO de los
// .md en la copia del repositorio del runner (no se commitean). Este script
// convierte cada .md a HTML con marked, lo envuelve en una página con estilos
// propios y genera un índice. Los diagramas ```mermaid se dibujan en el
// navegador con mermaid.js, con los colores del branding de la app
// (apps/frontend/tailwind.config.ts) y la tipografía Plus Jakarta Sans
// autoalojada (la misma de BL-222, sin Google Fonts).
//
// Uso: node scripts/publicar-dashboards.mjs [carpeta de salida]   (por defecto _site)

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = path.resolve(ROOT, process.argv[2] ?? "_site");

// Versiones fijas, como el resto del pipeline: se suben a propósito.
const MARKED_VERSION = "18.0.14";
const MERMAID_VERSION = "11.17.2";

// Tipografía de la app (BL-222), copiada al sitio junto con su licencia.
const FUENTES = [
  "apps/frontend/src/app/fonts/plus-jakarta-sans-latin-wght-normal.woff2",
  "apps/frontend/src/app/fonts/PlusJakartaSans-OFL.txt",
];

// Colores del branding (mismos valores que apps/frontend/tailwind.config.ts).
const COLORES = {
  fondo: "#fdf8ff", // background / surface
  superficie: "#ffffff", // surface-container-lowest
  superficieBaja: "#f7f2fa", // surface-container-low
  superficieMedia: "#f1ecf4", // surface-container
  borde: "#cbc4d2", // outline-variant
  texto: "#1c1b20", // on-surface
  textoSuave: "#494551", // on-surface-variant
  primario: "#381e72", // primary
  primarioContenedor: "#4f378a", // primary-container
  primarioClaro: "#e9ddff", // primary-fixed
  secundarioContenedor: "#e0d4fd", // secondary-container
  terciario: "#c9a74d", // tertiary-container (dorado)
  error: "#ba1a1a",
};

const DASHBOARDS = [
  {
    archivo: "docs/dashboard-avance-edt.md",
    salida: "avance-edt.html",
    titulo: "Avance del proyecto (EDT)",
    descripcion: "Historias de usuario y story points por capa y por sprint, desde Linear.",
  },
  {
    archivo: "docs/dashboard-bugs-github.md",
    salida: "bugs.html",
    titulo: "Bugs (GitHub Issues)",
    descripcion: "Bugs abiertos y cerrados, por severidad y por semana, desde GitHub Issues.",
  },
];

// Lo que está entre estos marcadores es solo para quien lee el .md en el
// repositorio (por ejemplo, el aviso de que la versión al día está en Pages).
const SOLO_REPO = /<!--\s*SOLO-REPO:start\s*-->[\s\S]*?<!--\s*SOLO-REPO:end\s*-->/g;

export function limpiarMarkdown(md) {
  return md.replace(SOLO_REPO, "");
}

export function escaparHtml(texto) {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// En Windows npx es un .cmd: Node no lo encuentra sin shell, y con shell
// hay que entrecomillar los argumentos (las rutas pueden tener espacios).
function ejecutarNpx(args) {
  const esWindows = process.platform === "win32";
  execFileSync(esWindows ? "npx.cmd" : "npx", esWindows ? args.map((a) => `"${a}"`) : args, {
    stdio: "inherit",
    shell: esWindows,
  });
}

function markdownAHtml(md, tmpDir, nombre) {
  const entrada = path.join(tmpDir, `${nombre}.md`);
  const salida = path.join(tmpDir, `${nombre}.html`);
  return fs
    .writeFile(entrada, md, "utf-8")
    .then(() => {
      ejecutarNpx(["--yes", `marked@${MARKED_VERSION}`, "-i", entrada, "-o", salida, "--gfm"]);
      return fs.readFile(salida, "utf-8");
    });
}

function fechaActualizacion() {
  return new Intl.DateTimeFormat("es-UY", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Montevideo",
  }).format(new Date());
}

export function temaMermaid() {
  const c = COLORES;
  return {
    fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
    background: c.superficie,
    primaryColor: c.primarioContenedor,
    primaryTextColor: "#ffffff",
    primaryBorderColor: c.primario,
    secondaryColor: c.secundarioContenedor,
    tertiaryColor: c.superficieBaja,
    lineColor: c.textoSuave,
    textColor: c.texto,
    // Gantt
    sectionBkgColor: c.superficieBaja,
    altSectionBkgColor: c.superficieMedia,
    sectionBkgColor2: c.superficieBaja,
    taskBkgColor: c.primarioContenedor,
    taskBorderColor: c.primario,
    taskTextColor: "#ffffff",
    taskTextOutsideColor: c.texto,
    taskTextDarkColor: c.texto,
    activeTaskBkgColor: c.terciario,
    activeTaskBorderColor: c.primario,
    doneTaskBkgColor: c.secundarioContenedor,
    doneTaskBorderColor: c.primarioContenedor,
    critBkgColor: c.error,
    critBorderColor: c.error,
    todayLineColor: c.error,
    gridColor: c.borde,
    // Torta
    pie1: c.primarioContenedor,
    pie2: c.terciario,
    pie3: "#63597c", // secondary
    pieOpacity: "1",
    pieStrokeColor: c.superficie,
    pieOuterStrokeColor: c.borde,
    pieTitleTextColor: c.texto,
    pieLegendTextColor: c.texto,
    pieSectionTextColor: "#ffffff",
    // Barras (xychart): primera serie dorada (planificado / abiertos),
    // segunda violeta (completado / cerrados).
    xyChart: {
      backgroundColor: c.superficie,
      titleColor: c.texto,
      xAxisLabelColor: c.textoSuave,
      xAxisTitleColor: c.textoSuave,
      xAxisTickColor: c.borde,
      xAxisLineColor: c.borde,
      yAxisLabelColor: c.textoSuave,
      yAxisTitleColor: c.textoSuave,
      yAxisTickColor: c.borde,
      yAxisLineColor: c.borde,
      plotColorPalette: `${c.terciario}, ${c.primarioContenedor}`,
    },
  };
}

export function pagina({ titulo, contenido, actualizado, conMermaid }) {
  const nav = [
    `<a href="./">Inicio</a>`,
    ...DASHBOARDS.map((d) => `<a href="./${d.salida}">${escaparHtml(d.titulo)}</a>`),
  ].join("\n        ");
  const scriptMermaid = conMermaid
    ? `
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.esm.min.mjs";
    // marked deja los bloques mermaid como <pre><code class="language-mermaid">.
    for (const code of document.querySelectorAll("pre > code.language-mermaid")) {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      code.parentElement.replaceWith(div);
    }
    // Los .md traen un %%{init}%% con colores pensados para el tema oscuro de
    // GitHub; acá se reemplaza por los colores del branding.
    for (const div of document.querySelectorAll(".mermaid")) {
      div.textContent = div.textContent.replace(/%%\\{init[\\s\\S]*?\\}%%\\s*/, "");
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: ${JSON.stringify(temaMermaid(), null, 2).replaceAll("\n", "\n      ")},
    });
    await mermaid.run({ querySelector: ".mermaid" });
  </script>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escaparHtml(titulo)} · BistroLink</title>
  <meta name="robots" content="noindex">
  <style>
    @font-face {
      font-family: "Plus Jakarta Sans";
      src: url("./plus-jakarta-sans-latin-wght-normal.woff2") format("woff2");
      font-weight: 200 800;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --fondo: ${COLORES.fondo}; --superficie: ${COLORES.superficie};
      --superficie-baja: ${COLORES.superficieBaja}; --borde: ${COLORES.borde};
      --texto: ${COLORES.texto}; --texto-suave: ${COLORES.textoSuave};
      --primario: ${COLORES.primario}; --primario-contenedor: ${COLORES.primarioContenedor};
      --primario-claro: ${COLORES.primarioClaro}; --secundario-contenedor: ${COLORES.secundarioContenedor};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--fondo); color: var(--texto);
      font: 16px/1.6 "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    header {
      background: var(--superficie); border-bottom: 1px solid var(--borde);
      position: sticky; top: 0; z-index: 1;
    }
    .barra { max-width: 1100px; margin: 0 auto; padding: 12px 16px;
      display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; }
    .marca { font-weight: 800; color: var(--primario); margin-right: auto; font-size: 1.1em; }
    nav { display: flex; flex-wrap: wrap; gap: 4px 16px; }
    nav a { color: var(--texto-suave); text-decoration: none; }
    nav a:hover { color: var(--primario-contenedor); }
    main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
    a { color: var(--primario-contenedor); }
    h1 { color: var(--primario); }
    h1, h2, h3 { line-height: 1.25; }
    h2 { margin-top: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--borde); }
    table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; margin: 1em 0; }
    th, td { border: 1px solid var(--borde); padding: 6px 12px; text-align: left; }
    th { background: var(--secundario-contenedor); color: var(--primario); }
    tr:nth-child(even) td { background: var(--superficie-baja); }
    blockquote { margin: 1em 0; padding: .5em 1em; border-left: 4px solid var(--primario-contenedor);
      background: var(--primario-claro); color: var(--texto-suave); border-radius: 0 8px 8px 0; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9em; }
    pre { overflow-x: auto; padding: 12px; background: var(--superficie); border: 1px solid var(--borde); border-radius: 8px; }
    .mermaid { background: var(--superficie); border: 1px solid var(--borde); border-radius: 12px; padding: 16px; overflow-x: auto; margin: 1em 0; }
    .tarjetas { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .tarjeta { display: block; padding: 20px; background: var(--superficie); border: 1px solid var(--borde);
      border-radius: 12px; text-decoration: none; color: var(--texto); }
    .tarjeta:hover { border-color: var(--primario-contenedor); box-shadow: 0 4px 20px rgba(121,118,125,.12); }
    .tarjeta strong { display: block; color: var(--primario); font-size: 1.1em; margin-bottom: 4px; }
    .pie { color: var(--texto-suave); font-size: .875em; margin-top: 32px; }
  </style>
</head>
<body>
  <header>
    <div class="barra">
      <span class="marca">BistroLink · Dashboards</span>
      <nav>
        ${nav}
      </nav>
    </div>
  </header>
  <main>
${contenido}
    <p class="pie">Publicado automáticamente por el workflow «Publicar dashboards» · ${escaparHtml(actualizado)} (hora de Uruguay)</p>
  </main>${scriptMermaid}
</body>
</html>
`;
}

async function main() {
  await fs.rm(SALIDA, { recursive: true, force: true });
  await fs.mkdir(SALIDA, { recursive: true });
  const tmpDir = await fs.mkdtemp(path.join(SALIDA, ".tmp-"));
  const actualizado = fechaActualizacion();

  for (const fuente of FUENTES) {
    await fs.copyFile(path.join(ROOT, fuente), path.join(SALIDA, path.basename(fuente)));
  }

  for (const [i, d] of DASHBOARDS.entries()) {
    const md = limpiarMarkdown(await fs.readFile(path.join(ROOT, d.archivo), "utf-8"));
    const contenido = await markdownAHtml(md, tmpDir, `dashboard-${i}`);
    await fs.writeFile(
      path.join(SALIDA, d.salida),
      pagina({ titulo: d.titulo, contenido, actualizado, conMermaid: true }),
      "utf-8",
    );
  }

  const tarjetas = DASHBOARDS.map(
    (d) => `      <a class="tarjeta" href="./${d.salida}">
        <strong>${escaparHtml(d.titulo)}</strong>
        ${escaparHtml(d.descripcion)}
      </a>`,
  ).join("\n");
  const indice = `    <h1>Dashboards de BistroLink</h1>
    <p>Estado del proyecto, generado automáticamente desde Linear y GitHub Issues.</p>
    <div class="tarjetas">
${tarjetas}
    </div>`;
  await fs.writeFile(
    path.join(SALIDA, "index.html"),
    pagina({ titulo: "Dashboards", contenido: indice, actualizado, conMermaid: false }),
    "utf-8",
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
  console.log(`✅ Sitio de dashboards generado en ${path.relative(ROOT, SALIDA) || "."}`);
}

// Solo corre main() si se ejecuta directo (no al importarlo desde un test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("❌ Error generando el sitio de dashboards:", err);
    process.exit(1);
  });
}
