// Setup de Jest para el frontend — hasta BL-160 no había ningún test acá
// (ver el placeholder no-op que tenía "test:cov" en package.json). La
// convención de carpeta/nombre ("test/unitarios/*.spec.ts") y el reporte
// jest-junit calcan lo que ya usa apps/backend/package.json (bloque "jest"),
// para que el job de CI "🧪 Tests unitarios (Jest)" y Codecov puedan tratar
// a los dos workspaces de la misma forma.
//
// `next/jest` delega la transformación de TS/JSX al compilador de Next
// (SWC), así que a diferencia del backend no hace falta declarar
// "transform"/ts-jest a mano.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- este archivo lo carga Node directo (CommonJS), no pasa por el build de Next/SWC
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  // 'node' alcanza para lo que hay hoy: los primeros tests son de lógica
  // pura (mapa-mesas.utils.ts), sin DOM. El día que se testeen componentes
  // con React Testing Library, esto pasa a 'jest-environment-jsdom'
  // (agregar esa dependencia en ese momento).
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Mismo criterio que el backend: los unitarios vivos en su propia
  // carpeta, separados de cualquier otra cosa que matchee "*.spec.ts" en el
  // repo — en particular, /e2e (Playwright, en la raíz del monorepo) usa esa
  // misma extensión pero no es competencia de este config (además de estar
  // fuera del rootDir de este workspace).
  testRegex: 'test/unitarios/.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
  // % de cobertura total va a salir bajo por ahora — es la primera vez que
  // hay tests de Jest acá, y esto mide contra TODO src/, no solo lo nuevo de
  // BL-160. No hay coverageThreshold (el backend tampoco lo tiene pese a la
  // "cobertura mínima 80%" del nombre del step de CI: es una meta, no un
  // gate automático todavía) — subir el % real es trabajo aparte, sumando
  // tests a medida que se toca cada componente.
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  coverageDirectory: 'coverage',
  reporters: ['default', 'jest-junit'],
};

module.exports = createJestConfig(customJestConfig);