/* Base común: red controlada y registro de errores de la página.
   - Las teselas del mapa base se cambian por un PNG vacío (rápido, sin cuota de Mapbox).
   - Directions y OSRM salen de fixtures/rutas.har (GRABAR=1 los pide en vivo y regraba).
   - LIVE=1 deja pasar todo a la red real. */
const base = require('@playwright/test');
const path = require('path');

const HAR = path.join(__dirname, '..', 'fixtures', 'rutas.har');
const PNG_VACIO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const RUTEO = /api\.mapbox\.com\/directions|router\.project-osrm\.org/;

const test = base.test.extend({
  errores: async ({}, use) => { await use([]); },

  page: async ({ page, errores }, use) => {
    page.on('pageerror', e => errores.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });
    page.on('response', r => {
      const u = r.url();
      if (r.status() >= 400 && /^http:\/\/localhost/.test(u)) errores.push(`${r.status()} ${u}`);
    });

    if (!process.env.LIVE) {
      await page.route(/api\.mapbox\.com\/styles\/.*\/tiles\//, r => r.fulfill({ contentType: 'image/png', body: PNG_VACIO }));
      // GRABAR solo lo usa grabar.spec.js (un único contexto escribe el HAR al cerrarse)
      await page.routeFromHAR(HAR, { url: RUTEO, update: !!process.env.GRABAR, updateContent: 'embed', notFound: 'abort' });
    }
    await use(page);
  },
});

/* Calcula una ruta con uno de los botones de ejemplo o llenando el formulario */
async function calcular(page, origen, destino) {
  await page.locator('#inputOrigen').fill(origen.split(',')[0]);
  await page.locator('#listOrigen .ac-item', { hasText: origen.split(',')[0] }).first().dispatchEvent('mousedown');
  await page.locator('#inputDestino').fill(destino.split(',')[0]);
  await page.locator('#listDestino .ac-item', { hasText: destino.split(',')[0] }).first().dispatchEvent('mousedown');
  await page.locator('#calcBtn').click();
  await base.expect(page.locator('#resultsWrap')).toBeVisible({ timeout: 20_000 });
}

/* Lee el tiquete: filas con número, nombre y tarifa, y el total */
async function leerTiquete(page) {
  return page.evaluate(() => {
    const num = s => +(s || '').replace(/[^\d]/g, '') || 0;
    const filas = [...document.querySelectorAll('#tiquete button.fila')].map(b => ({
      nro: +b.querySelector('.nro').textContent,
      nombre: b.querySelector('.nm').childNodes[0].textContent.trim(),
      tarifa: b.classList.contains('sin') ? null : num(b.querySelector('.v').textContent),
    }));
    return {
      filas,
      total: num(document.querySelector('#tiquete .total span:last-child').textContent),
      totalCabecera: num(document.getElementById('rTotal').textContent),
      marcadores: document.querySelectorAll('#routeMap .leaflet-marker-icon .mk-nro').length,
    };
  });
}

// Elige la categoría como lo haría la persona: en el teléfono abre el chip y toca
// la opción en la hoja; en escritorio toca la fila de la cabecera
async function elegirCategoria(page, c) {
  const chip = page.locator('.veh-chip');
  if (await chip.isVisible()) await chip.click();
  await page.locator(`.vehiculo label:has(input[value="${c}"])`).click();
  await base.expect(page.locator('.vehiculo')).not.toHaveClass(/abierta/);
}

module.exports = { test, expect: base.expect, calcular, leerTiquete, elegirCategoria };
