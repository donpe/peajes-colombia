// Pruebas de QA de Peajes de Colombia.
// Corren contra docs/ servido en local, en el Chrome instalado (sin descargar navegadores).
// El ruteo (Mapbox Directions y OSRM) se reproduce desde fixtures/rutas.har para que
// las pruebas no dependan de la red ni gasten cuota; `npm run grabar` lo regraba.
const { defineConfig, devices } = require('@playwright/test');

const PUERTO = 8430;

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  // pocos Chrome a la vez y sin caché en disco: cada uno ocupa cientos de MB mientras corre
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/resultados.json' }]],
  use: {
    baseURL: process.env.BASE_URL || `http://localhost:${PUERTO}/`,
    channel: 'chrome',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: process.env.TRAZAS ? 'retain-on-failure' : 'off',   // TRAZAS=1 para depurar (ocupan mucho disco)
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--disk-cache-size=1', '--media-cache-size=1'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
  webServer: process.env.BASE_URL ? undefined : {
    command: `python3 -m http.server ${PUERTO}`,
    cwd: '../docs',
    port: PUERTO,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
