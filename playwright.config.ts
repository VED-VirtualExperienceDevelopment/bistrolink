import { defineConfig, devices } from '@playwright/test';

// Config a nivel raíz del monorepo, a propósito: el job de CI comentado en
// .github/workflows/ci.yml (JOB 10) corre `npx playwright test` desde acá,
// contra un BASE_URL de staging ya desplegado — no levanta servidores
// nuevos. En local, BASE_URL cae a localhost y hay que tener el backend y
// el frontend corriendo a mano (con datos del seed) antes de correr esto,
// como venimos haciendo manualmente en esta sesión.
export default defineConfig({
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
  ],
});