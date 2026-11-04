/* Barrido de anchos: el diseño cambia a teléfono en 860px, pero entre 320 y 1920
   hay muchos tamaños reales (teléfonos chicos, plegables, tabletas, ventanas a medias).
   En cada ancho se revisa que nada se salga, que nada se corte, que nada se monte
   y se guarda una captura para revisarla a ojo. */
const { test, expect } = require('./fixtures');

const ANCHOS = [320, 360, 375, 390, 414, 480, 600, 768, 820, 859, 861, 1024, 1280, 1920];
const PAGINAS = [
  { nombre: 'viaje', url: 'index.html?o=Medell%C3%ADn%2C+Antioquia&d=San+Agust%C3%ADn%2C+Huila&cat=I', listo: '#tiquete .total' },
  { nombre: 'mapa', url: 'mapa.html?peaje=rio-frio', listo: '#detailName' },
  { nombre: 'datos', url: 'dashboard.html', listo: '#claves li' },
  { nombre: 'acerca', url: 'about.html', listo: 'h1' },
];

test.skip(({ isMobile }) => isMobile, 'el barrido fija su propio ancho');
test.setTimeout(60_000);   // capturas de página completa

for (const p of PAGINAS) for (const ancho of ANCHOS) {
  test(`${p.nombre} a ${ancho}px`, async ({ page }, info) => {
    await page.setViewportSize({ width: ancho, height: ancho < 861 ? 800 : 900 });
    await page.goto(p.url);
    await page.locator(p.listo).first().waitFor({ state: 'attached' });
    await page.waitForTimeout(400);

    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const visible = e => { const s = getComputedStyle(e); return e.offsetParent !== null && s.visibility !== 'hidden' && s.display !== 'none'; };
      const dentroDelMapa = e => !!e.closest('.leaflet-container');
      const nombre = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''} "${(e.textContent || '').trim().slice(0, 30)}"`;
      const todos = [...document.querySelectorAll('body *')].filter(e => visible(e) && !dentroDelMapa(e));

      // 1. nada se sale por la derecha (ni por la izquierda)
      const salidos = todos.filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1); })
        .filter(e => !e.closest('.skip-link'))
        .map(e => `${nombre(e)} ${Math.round(e.getBoundingClientRect().right)}>${vw}`);

      // 2. texto cortado: un control o etiqueta cuyo contenido no cabe en su caja
      const cortados = [...document.querySelectorAll('button, a, label, select, h1, h2, h3, .monto, .v, .nm, .etq, .val, .route-option b, .route-option small')]
        .filter(e => visible(e) && !dentroDelMapa(e))
        .filter(e => { const s = getComputedStyle(e); return /hidden|clip|auto/.test(s.overflow + s.overflowX) && e.scrollWidth > e.clientWidth + 1; })
        .map(nombre);

      // 3. en cada fila del tiquete y de las listas, nombre y valor no se montan
      const montados = [...document.querySelectorAll('#tiquete .fila, .lista-item, #caros li, #baratos li, #cerca li, .barras li')]
        .filter(visible).filter(f => {
          const a = f.querySelector('.nm, .n, .etq'), b = f.querySelector('.v, .val');
          if (!a || !b) return false;
          const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
          return x.right > y.left + 1 && x.left < y.right && x.bottom > y.top + 1 && x.top < y.bottom;
        }).map(nombre);

      // 4. el selector de vehículo en una sola fila
      const opts = [...document.querySelectorAll('.vehiculo label')].map(l => l.getBoundingClientRect().top);
      const vehiculoEnUnaFila = opts.length ? Math.max(...opts) - Math.min(...opts) < 2 : true;

      // 5. el título principal en tres líneas o menos
      const h1 = document.querySelector('h1');
      const lineasH1 = h1 ? Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight || 1)) : 0;

      // 6. el mapa, si hay, tiene alto útil
      const mapa = document.querySelector('#routeMap, #map');
      const altoMapa = mapa ? mapa.getBoundingClientRect().height : null;

      return { vw, sw: document.documentElement.scrollWidth, salidos, cortados, montados, vehiculoEnUnaFila, lineasH1, altoMapa };
    });

    await page.screenshot({ path: info.outputPath(`${p.nombre}-${ancho}.png`), fullPage: true });

    expect.soft(r.sw, 'desborde horizontal de la página').toBeLessThanOrEqual(r.vw);
    expect.soft(r.salidos, 'elementos fuera de la pantalla').toEqual([]);
    expect.soft(r.cortados, 'texto cortado').toEqual([]);
    expect.soft(r.montados, 'nombre y valor montados').toEqual([]);
    expect.soft(r.vehiculoEnUnaFila, '"Tu vehículo" partido en dos filas').toBe(true);
    expect.soft(r.lineasH1, 'h1 de más de 3 líneas').toBeLessThanOrEqual(3);
    if (r.altoMapa != null) expect.soft(r.altoMapa, 'mapa muy bajo').toBeGreaterThanOrEqual(260);
  });
}
