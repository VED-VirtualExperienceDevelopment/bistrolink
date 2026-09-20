import { defineConfig, devices } from '@playwright/test';

// Config a nivel raíz del monorepo, a propósito: el job de CI comentado en
// .github/workflows/ci.yml (JOB 10) corre `npx playwright test` desde acá,
// contra un BASE_URL de staging ya desplegado — no levanta servidores
// nuevos. En local, BASE_URL cae a localhost y hay que tener el backend y
// el frontend corriendo a mano (con datos del seed) antes de correr esto,
// como venimos haciendo manualmente en esta sesión.
export default defineConfig({
  // BL-181: los specs viven en subcarpetas por dominio (e2e/comensal/,
  // e2e/kds/) más e2e/support/ (fixtures e IDs de seed compartidos, sin
  // tests propios). testDir sigue siendo './e2e' sin cambios: Playwright ya
  // busca specs recursivamente, y los testMatch de abajo no están anclados
  // al path, así que "menu-publico.spec.ts" sigue matcheando
  // "e2e/comensal/menu-publico.spec.ts" sin tocar nada más.
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // HU-002 (subtask Testing): el criterio del ticket pide verificar el
    // acceso por URL directa en Chrome y Safari mobile; se suma Safari de
    // escritorio para cubrir también el caso desktop (si bien en el mercado de UY no es lo mas frecuente, es un navegador que va ganando terreno dado el acceso a macOS). 
    // testMatch acota estos
    // proyectos al spec nuevo para no alterar la corrida desktop de HU-001.
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: /menu-publico\.spec\.ts/,
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
      testMatch: /menu-publico\.spec\.ts/,
    },
    {
      name: 'desktop-safari',
      use: { ...devices['Desktop Safari'] },
      testMatch: /menu-publico\.spec\.ts/,
    },
  ],
});
