/* Todo el sitio: carga sin errores, metadatos, accesibilidad (axe), desborde
   horizontal, modo oscuro, enlaces internos y capturas para revisión visual. */
const { test, expect } = require('./fixtures');
const AxeBuilder = require('@axe-core/playwright').default;

const PAGINAS = [
  { url: 'index.html', listo: '#leyenda > span' },
  { url: 'index.html?o=Medell%C3%ADn%2C+Antioquia&d=San+Agust%C3%ADn%2C+Huila&cat=I', listo: '#tiquete .total', nombre: 'viaje-con-ruta' },
  { url: 'mapa.html', listo: '#list .lista-item' },
  { url: 'mapa.html?peaje=rio-frio', listo: '#detailName', nombre: 'mapa-con-ficha' },
  { url: 'dashboard.html', listo: '#claves li' },
  { url: 'about.html', listo: 'h1' },
];
const nombre = p => p.nombre || p.url.replace('.html', '');

for (const p of PAGINAS) {
  test.describe(nombre(p), () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(p.url);
      await page.locator(p.listo).first().waitFor({ state: 'attached' });
    });

    test('carga sin errores de consola ni recursos rotos', async ({ page, errores }) => {
      await page.waitForLoadState('networkidle');
      expect(errores).toEqual([]);
    });

    test('metadatos básicos y un solo h1', async ({ page }) => {
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      expect((await page.title()).length).toBeGreaterThan(10);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
      if (!p.url.startsWith('mapa.html?')) await expect(page.locator('meta[name="description"]')).toHaveCount(1);
    });

    test('sin desborde horizontal', async ({ page }) => {
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw).toBeLessThanOrEqual(cw);
    });

    test('accesibilidad: sin fallas graves de axe', async ({ page }, info) => {
      test.setTimeout(90_000);   // axe recorre cientos de marcadores del mapa
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])// Los peajes de la ruta en el mapa tienen su equivalente tocable en el tiquete
      // (excepción "equivalente" de WCAG 2.5.8), así que no cuentan para target-size.
      .exclude('.leaflet-tile-pane').exclude('.mk-ruta').analyze();
      const graves = r.violations.filter(v => ['serious', 'critical'].includes(v.impact));
      await info.attach('axe.json', { body: JSON.stringify(r.violations, null, 2), contentType: 'application/json' });
      expect(graves.map(v => `${v.id} (${v.impact}): ${v.nodes.length} nodos — ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });

    test('el enlace para saltar al contenido funciona', async ({ page, isMobile }) => {
      test.skip(isMobile, 'teclado físico');
      test.skip(p.url.includes('peaje='), 'la ficha abierta ya tiene el foco');
      await page.keyboard.press('Tab');
      const skip = page.locator('.skip-link');
      await expect(skip).toBeFocused();
      const destino = await skip.getAttribute('href');
      await page.keyboard.press('Enter');
      await expect(page.locator(destino)).toBeFocused();
    });

    test('captura clara y oscura', async ({ page }, info) => {
      await page.waitForTimeout(600);
      await page.screenshot({ path: info.outputPath(`${nombre(p)}-claro.png`), fullPage: true });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(300);
      const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const [r, g, b] = fondo.match(/\d+/g).map(Number);
      expect(r + g + b).toBeLessThan(200);   // el modo oscuro de verdad oscurece el fondo
      await page.screenshot({ path: info.outputPath(`${nombre(p)}-oscuro.png`), fullPage: true });
    });
  });
}

test('enlaces internos sin romper', async ({ page, request }) => {
  const vistos = new Set(), rotos = [];
  for (const url of ['index.html', 'mapa.html', 'dashboard.html', 'about.html']) {
    await page.goto(url);
    const hrefs = await page.$$eval('a[href]', as => as.map(a => a.href).filter(h => h.startsWith(location.origin)));
    for (const h of hrefs) {
      const limpio = h.split('#')[0];
      if (vistos.has(limpio)) continue;
      vistos.add(limpio);
      const r = await request.get(limpio);
      if (!r.ok()) rotos.push(`${r.status()} ${limpio} (en ${url})`);
    }
  }
  expect(rotos).toEqual([]);
});

test('archivos para buscadores y LLM', async ({ request }) => {
  for (const f of ['robots.txt', 'sitemap.xml', 'llms.txt', 'favicon.svg', 'data/peajes_clean.json']) {
    expect((await request.get(f)).ok(), f).toBe(true);
  }
  const sitemap = await (await request.get('sitemap.xml')).text();
  for (const pag of ['mapa.html', 'dashboard.html', 'about.html']) expect(sitemap).toContain(pag);
});

test('móvil: en la portada el formulario va antes del mapa y el tiquete después', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'solo en el teléfono');
  await page.goto('index.html?o=Ibagu%C3%A9%2C+Tolima&d=Armenia%2C+Quind%C3%ADo&cat=I');
  await page.locator('#tiquete .total').waitFor();
  const y = sel => page.locator(sel).evaluate(e => e.getBoundingClientRect().top + scrollY);
  const form = await y('#routeForm'), mapa = await y('#routeMap'), tiquete = await y('#tiquete');
  expect(form).toBeLessThan(mapa);
  expect(mapa).toBeLessThan(tiquete);
});

test('móvil: los controles tocables miden al menos 24px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'solo en el teléfono');
  const chicos = [];
  for (const url of ['index.html', 'mapa.html', 'dashboard.html']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    chicos.push(...await page.$$eval('button, a[href], input, select, label:has(input)', es => es
      // los radios de "Tu vehículo" son invisibles: se toca su etiqueta, que sí se mide
      .filter(e => e.offsetParent && getComputedStyle(e).opacity !== '0' && !e.closest('.leaflet-control-attribution, p, li .n, .expl, .creditos'))
      .filter(e => !(e.tagName === 'INPUT' && e.closest('label')))   // se toca la etiqueta entera
      .map(e => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 24 || r.height < 24))
      .map(({ e, r }) => `${location.pathname.split('/').pop()} ${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 25)}" ${Math.round(r.width)}×${Math.round(r.height)}`)));
  }
  expect(chicos).toEqual([]);
});
