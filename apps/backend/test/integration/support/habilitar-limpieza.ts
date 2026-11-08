// BL-476 (BL-285): el módulo de limpieza se registra al cargar AppModule,
// según E2E_CLEANUP_ENABLED. Este archivo se importa ANTES que AppModule en
// limpieza.e2e-spec.ts, para que la variable ya esté puesta. No afecta a las
// demás suites: cada archivo de test corre con su propio registro de módulos.
process.env.E2E_CLEANUP_ENABLED = 'true';

export {};
