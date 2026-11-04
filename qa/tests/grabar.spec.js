/* Graba en fixtures/rutas.har las respuestas reales de Mapbox Directions y OSRM
   para las rutas que usan las demás pruebas. Solo corre con GRABAR=1:
   npm run grabar */
const { test, calcular } = require('./fixtures');

const RUTAS = [
  ['Ibagué, Tolima', 'Armenia, Quindío'],
  ['Armenia, Quindío', 'Ibagué, Tolima'],
  ['Bogotá D.C., Bogotá D.C.', 'Medellín, Antioquia'],
  ['Cali, Valle del Cauca', 'Buenaventura, Valle del Cauca'],
  ['Medellín, Antioquia', 'San Agustín, Huila'],
];

test.skip(!process.env.GRABAR, 'solo para regrabar el HAR');
test.setTimeout(180_000);

test('grabar rutas', async ({ page }) => {
  for (const [o, d] of RUTAS) {
    await page.goto(`index.html?o=${encodeURIComponent(o)}&d=${encodeURIComponent(d)}&cat=I`);
    await page.locator('#resultsWrap').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForLoadState('networkidle');
  }
  // la misma de Ibagué con "evitar peajes"
  await page.goto('index.html?o=Ibagu%C3%A9%2C+Tolima&d=Armenia%2C+Quind%C3%ADo&cat=I&evitar=1');
  await page.locator('#resultsWrap').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle');
});
