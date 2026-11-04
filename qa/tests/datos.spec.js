/* Datos: las seis preguntas se dibujan y se recalculan con el vehículo. */
const { test, expect, elegirCategoria } = require('./fixtures');

test.beforeEach(async ({ page }) => {
  await page.goto('dashboard.html');
  await expect(page.locator('#claves li')).toHaveCount(3);
});

test('cifras clave y cambio de vehículo', async ({ page }) => {
  await expect(page.locator('#claves')).toContainText('categoría I');
  const antes = await page.locator('#claves li b').first().textContent();
  await elegirCategoria(page, 'V');
  await expect(page.locator('#claves')).toContainText('categoría V');
  expect(await page.locator('#claves li b').first().textContent()).not.toBe(antes);
  await expect(page.locator('#cats li.on')).toContainText('V ·');
});

test('la mediana publicada es la de los datos', async ({ page }) => {
  const esperada = await page.evaluate(() => {
    const v = peajes.map(p => p.categorias && p.categorias.I).filter(x => x != null).sort((a, b) => a - b), m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  });
  await expect(page.locator('#claves li b').first()).toHaveText('$' + Math.round(esperada).toLocaleString('es-CO'));
});

test('histograma: cabe en su caja y la suma de columnas es el total con tarifa', async ({ page }) => {
  const { ancho, caja, suma, conTarifa } = await page.evaluate(() => ({
    ancho: document.querySelector('#dist svg').getBoundingClientRect().width,
    caja: document.getElementById('dist').clientWidth,
    suma: [...document.querySelectorAll('#dist g.col text.n')].reduce((s, t) => s + +t.textContent, 0),
    conTarifa: peajes.filter(p => p.categorias && p.categorias.I != null).length,
  }));
  expect(ancho).toBeLessThanOrEqual(caja + 1);
  expect(suma).toBe(conTarifa);
});

test('las columnas muestran el detalle con el teclado', async ({ page }) => {
  await page.locator('#dist g.col').first().focus();
  await expect(page.locator('#tip')).toBeVisible();
  await expect(page.locator('#tip')).toContainText('peaje');
});

test('listas: 5 categorías, 10 departamentos, extremos ordenados, cercanos ordenados', async ({ page }) => {
  await expect(page.locator('#cats li')).toHaveCount(5);
  await expect(page.locator('#deptos li')).toHaveCount(10);
  const v = sel => page.$$eval(sel, es => es.map(e => +e.textContent.replace(/[^\d,]/g, '').replace(',', '.')));
  const caros = await v('#caros .v'), baratos = await v('#baratos .v'), cerca = await v('#cerca .v');
  expect(caros).toHaveLength(6);
  expect([...caros].sort((a, b) => b - a)).toEqual(caros);
  expect([...baratos].sort((a, b) => a - b)).toEqual(baratos);
  expect(Math.min(...caros)).toBeGreaterThanOrEqual(Math.max(...baratos));
  expect([...cerca].sort((a, b) => a - b)).toEqual(cerca);
  const deptos = await page.$$eval('#deptos .val', es => es.map(e => parseInt(e.textContent)));
  expect([...deptos].sort((a, b) => b - a)).toEqual(deptos);
});
