/* Viaje (portada): autocompletado, validación, cálculo de la ruta, tiquete,
   cambio de vehículo, rutas alternas, estado en la URL y manejo de errores. */
const { test, expect, calcular, leerTiquete } = require('./fixtures');

const IBAGUE_ARMENIA = 'index.html?o=Ibagu%C3%A9%2C+Tolima&d=Armenia%2C+Quind%C3%ADo&cat=I';
const BOGOTA_MEDELLIN = 'index.html?o=Bogot%C3%A1+D.C.%2C+Bogot%C3%A1+D.C.&d=Medell%C3%ADn%2C+Antioquia&cat=I';
const MEDELLIN_SANAGUSTIN = 'index.html?o=Medell%C3%ADn%2C+Antioquia&d=San+Agust%C3%ADn%2C+Huila&cat=I';
const pesos = n => '$' + n.toLocaleString('es-CO');

test.describe('portada', () => {
  test('carga con el formulario y sin resultados', async ({ page }) => {
    await page.goto('index.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('¿Cuánto pagas de peajes?');
    await expect(page.locator('#resultsWrap')).toBeHidden();
    await expect(page.locator('#ejemplos button')).toHaveCount(3);
    await expect(page.locator('#leyenda > span')).toHaveCount(3);
    await expect(page.locator('nav.tabs a[aria-current="page"]')).toHaveText('Viaje');
    await expect(page.locator('.vehiculo input[value="I"]')).toBeChecked();
  });
});

test.describe('autocompletado', () => {
  test('sugiere, navega con flechas y elige con Enter', async ({ page }) => {
    await page.goto('index.html');
    const input = page.locator('#inputOrigen');
    await input.fill('ibag');
    await expect(page.locator('#listOrigen')).toBeVisible();
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#listOrigen .ac-item').first()).toContainText('Ibagué');
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'listOrigen-0');
    await expect(page.locator('#listOrigen-0')).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(input).toHaveValue('Ibagué, Tolima');
    await expect(page.locator('#listOrigen')).toBeHidden();
    await expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  test('no distingue tildes ni mayúsculas', async ({ page }) => {
    await page.goto('index.html');
    await page.locator('#inputDestino').fill('BOGOTA');
    await expect(page.locator('#listDestino .ac-item').first()).toContainText('Bogotá');
  });

  test('avisa cuando no hay resultados y Escape cierra la lista', async ({ page }) => {
    await page.goto('index.html');
    const input = page.locator('#inputOrigen');
    await input.fill('zzzzq');
    await expect(page.locator('#listOrigen .ac-empty')).toContainText('Sin resultados');
    await input.press('Escape');
    await expect(page.locator('#listOrigen')).toBeHidden();
  });

  test('escribir "municipio, departamento" completo también encuentra el municipio', async ({ page }) => {
    await page.goto('index.html');
    await page.locator('#inputOrigen').fill('Armenia, Quindío');
    await expect(page.locator('#listOrigen .ac-item').first()).toContainText('Armenia');
  });

  test('la lista abierta no tapa el botón Calcular', async ({ page }) => {
    await page.goto('index.html');
    await page.locator('#inputDestino').fill('zzzzq');
    await page.locator('#calcBtn').click({ timeout: 3000 });
    await expect(page.locator('#routeStatus')).toHaveClass(/error/);
  });

  test('a lo sumo 8 sugerencias, primero las que empiezan por el texto', async ({ page }) => {
    await page.goto('index.html');
    await page.locator('#inputOrigen').fill('san');
    const items = page.locator('#listOrigen .ac-item b');
    await expect(items).toHaveCount(8);
    for (const t of await items.allTextContents()) expect(t.toLowerCase().startsWith('san')).toBe(true);
  });
});

test.describe('validación', () => {
  test('sin origen ni destino muestra el error y enfoca el origen', async ({ page }) => {
    await page.goto('index.html');
    await page.locator('#calcBtn').click();
    await expect(page.locator('#routeStatus')).toHaveText('Elige un origen y un destino de la lista de sugerencias.');
    await expect(page.locator('#routeStatus')).toHaveClass(/error/);
    await expect(page.locator('#inputOrigen')).toBeFocused();
  });

  test('texto escrito sin elegir de la lista no cuenta como municipio', async ({ page }) => {
    await page.goto('index.html');
    await page.locator('#inputOrigen').fill('Ibagué');
    await page.locator('#inputDestino').fill('Armenia');
    await page.locator('#inputDestino').press('Escape');
    await page.locator('#calcBtn').click();
    await expect(page.locator('#routeStatus')).toHaveClass(/error/);
  });

  test('origen y destino iguales', async ({ page }) => {
    await page.goto('index.html?o=Ibagu%C3%A9%2C+Tolima&d=Ibagu%C3%A9%2C+Tolima');
    await expect(page.locator('#routeStatus')).toHaveText('El origen y el destino son el mismo municipio.');
    await expect(page.locator('#resultsWrap')).toBeHidden();
  });
});

test.describe('@ruta cálculo', () => {
  test('ejemplo de un clic: Ibagué → Armenia', async ({ page }) => {
    await page.goto('index.html');
    await page.getByRole('button', { name: 'Ibagué → Armenia' }).click();
    await expect(page.locator('#rTitulo')).toHaveText('Ibagué → Armenia');
    const t = await leerTiquete(page);
    expect(t.filas.map(f => f.nombre)).toEqual(['Cocora', 'Túnel de la Línea (Tolima)']);
    expect(t.total).toBe(27200);
    await expect(page.locator('#rSub')).toContainText('2 peajes · categoría I');
    await expect(page).toHaveURL(/o=Ibagu%C3%A9%2C\+Tolima&d=Armenia%2C\+Quind%C3%ADo&cat=I/);
  });

  test('el tiquete cuadra: total = suma, números seguidos, uno por marcador', async ({ page }) => {
    for (const url of [IBAGUE_ARMENIA, BOGOTA_MEDELLIN, MEDELLIN_SANAGUSTIN]) {
      await page.goto(url);
      await page.locator('#tiquete .total').waitFor();
      const t = await leerTiquete(page);
      expect(t.filas.length).toBeGreaterThan(0);
      expect(t.total).toBe(t.filas.reduce((s, f) => s + (f.tarifa || 0), 0));
      expect(t.totalCabecera).toBe(t.total);
      expect(t.filas.map(f => f.nro)).toEqual(t.filas.map((_, i) => i + 1));
      expect(t.marcadores).toBe(t.filas.length);
      // las paradas de origen y destino cierran la vía
      await expect(page.locator('#tiquete .parada')).toHaveCount(2);
    }
  });

  test('el km de cada peaje crece y no pasa del total de la ruta', async ({ page }) => {
    await page.goto(MEDELLIN_SANAGUSTIN);
    await page.locator('#tiquete .total').waitFor();
    const kms = await page.$$eval('#tiquete .trayecto small', ss => ss.map(s => +s.textContent.match(/km (\d+)/)[1]));
    expect(kms[0]).toBe(0);
    for (let i = 1; i < kms.length; i++) expect(kms[i]).toBeGreaterThanOrEqual(kms[i - 1]);
  });

  test('un enlace compartido calcula la ruta al abrir y llena los campos', async ({ page }) => {
    await page.goto(IBAGUE_ARMENIA);
    await expect(page.locator('#inputOrigen')).toHaveValue('Ibagué, Tolima');
    await expect(page.locator('#inputDestino')).toHaveValue('Armenia, Quindío');
    await expect(page.locator('#rTotal')).toHaveText(pesos(27200));
  });

  test('intercambiar origen y destino', async ({ page }) => {
    await page.goto(IBAGUE_ARMENIA);
    await page.locator('#tiquete .total').waitFor();
    await page.locator('#swapBtn').click();
    await expect(page.locator('#inputOrigen')).toHaveValue('Armenia, Quindío');
    await page.locator('#calcBtn').click();
    await expect(page.locator('#rTitulo')).toHaveText('Armenia → Ibagué');
    await expect(page.locator('#tiquete .fila .nm').first()).toContainText('Túnel de la Línea (Quindío)');
  });

  test('cambiar de vehículo recalcula sin volver a pedir la ruta', async ({ page }) => {
    await page.goto(IBAGUE_ARMENIA);
    await page.locator('#tiquete .total').waitFor();
    const pedidas = [];
    page.on('request', r => { if (r.url().includes('/directions/')) pedidas.push(r.url()); });
    await page.locator('.vehiculo label', { hasText: /^V$/ }).click();
    await expect(page.locator('#rSub')).toContainText('categoría V');
    const t = await leerTiquete(page);
    expect(t.total).toBeGreaterThan(27200);
    expect(t.total).toBe(t.filas.reduce((s, f) => s + (f.tarifa || 0), 0));
    await expect(page).toHaveURL(/cat=V/);
    await expect(page.locator('#tiquete header')).toContainText('Categoría V');
    expect(pedidas).toHaveLength(0);
  });

  test('el vehículo elegido se recuerda en otra visita', async ({ page }) => {
    await page.goto('index.html');
    await page.locator('.vehiculo label', { hasText: /^III$/ }).click();
    await page.goto('dashboard.html');
    await expect(page.locator('.vehiculo input[value="III"]')).toBeChecked();
    await expect(page.locator('#claves')).toContainText('categoría III');
  });

  test('evitar peajes vuelve a pedir la ruta con exclude=toll', async ({ page }) => {
    await page.goto(IBAGUE_ARMENIA);
    await page.locator('#tiquete .total').waitFor();
    const pedida = page.waitForRequest(r => r.url().includes('/directions/') && r.url().includes('exclude=toll'));
    await page.locator('#avoidTolls').check();
    await pedida;
    await expect(page.locator('#tiquete')).toContainText('No se detectaron peajes en esta ruta.');
    await expect(page.locator('#rTotal')).toHaveText('$0');
    await expect(page).toHaveURL(/evitar=1/);
  });

  test('rutas alternas: se elige una y cambia el tiquete', async ({ page }) => {
    await page.goto(BOGOTA_MEDELLIN);
    const opciones = page.locator('#routeOptions .route-option');
    await expect(opciones).toHaveCount(2);
    await expect(opciones.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(opciones.nth(0)).toContainText('Más rápida');
    await expect(page.locator('#routeStatus')).toHaveText('Hay 2 rutas posibles; elige una para ver sus peajes.');
    await opciones.nth(1).click();
    await expect(opciones.nth(1)).toHaveAttribute('aria-pressed', 'true');
    const t = await leerTiquete(page);
    expect(t.filas).toHaveLength(13);
    expect(t.total).toBe(185400);
  });

  test('tocar un peaje del tiquete lo marca en el mapa y abre su ficha', async ({ page }) => {
    await page.goto(BOGOTA_MEDELLIN);
    await page.locator('#tiquete .total').waitFor();
    const fila = page.locator('#tiquete button.fila').nth(2);
    await fila.click();
    await expect(fila).toHaveClass(/\bon\b/);
    await expect(page.locator('#routeMap .leaflet-marker-icon.activo')).toHaveCount(1);
    await expect(page.locator('#routeMap .leaflet-marker-icon.activo .mk-nro')).toHaveText('3');
    await expect(page.locator('.leaflet-popup .popup b')).toHaveText('Puerto Triunfo');
    await expect.poll(() => page.evaluate(() => map.getZoom())).toBeGreaterThanOrEqual(13);
  });

  test('con muchos peajes las etiquetas visibles del mapa no se montan', async ({ page }) => {
    await page.goto(MEDELLIN_SANAGUSTIN);
    await page.locator('#tiquete .total').waitFor();
    await page.waitForTimeout(800);   // encuadre y despeje de etiquetas
    const choques = await page.evaluate(() => {
      const r = [...document.querySelectorAll('#routeMap .mk-nro, #routeMap .mk-precio')]
        .filter(e => getComputedStyle(e).visibility !== 'hidden').map(e => e.getBoundingClientRect());
      let n = 0;
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++)
        if (r[i].left < r[j].right && r[i].right > r[j].left && r[i].top < r[j].bottom && r[i].bottom > r[j].top) n++;
      return n;
    });
    expect(choques).toBe(0);
  });
});

test.describe('errores del servicio', () => {
  test('Mapbox responde 500: mensaje y botón habilitado', async ({ page }) => {
    await page.goto('index.html');
    await page.route(/directions/, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Error del servidor"}' }));
    await page.getByRole('button', { name: 'Ibagué → Armenia' }).click();
    await expect(page.locator('#routeStatus')).toHaveText('Error del servidor');
    await expect(page.locator('#routeStatus')).toHaveClass(/error/);
    await expect(page.locator('#calcBtn')).toBeEnabled();
  });

  test('sin ruta por carretera', async ({ page }) => {
    await page.goto('index.html');
    await page.route(/directions/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"code":"NoRoute","routes":[]}' }));
    await page.getByRole('button', { name: 'Ibagué → Armenia' }).click();
    await expect(page.locator('#routeStatus')).toHaveText('No se encontró una ruta por carretera entre esos dos puntos.');
  });

  test('sin red: el mensaje no queda en un error técnico del navegador', async ({ page }) => {
    await page.goto('index.html');
    await page.route(/directions/, r => r.abort('internetdisconnected'));
    await page.getByRole('button', { name: 'Ibagué → Armenia' }).click();
    await expect(page.locator('#routeStatus')).toHaveClass(/error/);
    await expect(page.locator('#routeStatus')).not.toHaveText(/Failed to fetch|NetworkError|TypeError/i);
  });

  test('si OSRM no responde igual hay resultado', async ({ page }) => {
    await page.route(/router\.project-osrm\.org/, r => r.abort());
    await page.goto(IBAGUE_ARMENIA);
    await expect(page.locator('#tiquete .total')).toBeVisible({ timeout: 20_000 });
  });

  test('mientras calcula el botón se deshabilita', async ({ page }) => {
    await page.goto('index.html');
    let soltar;
    await page.route(/directions/, async r => { await new Promise(res => { soltar = res; }); await r.fallback(); });
    await page.getByRole('button', { name: 'Ibagué → Armenia' }).click();
    await expect(page.locator('#calcBtn')).toBeDisabled();
    await expect(page.locator('#routeStatus')).toHaveText('Calculando ruta…');
    soltar();
    await expect(page.locator('#calcBtn')).toBeEnabled({ timeout: 20_000 });
  });
});

test.describe('redirecciones', () => {
  test('ruta.html lleva a la portada con la consulta', async ({ page }) => {
    await page.goto('ruta.html?o=Ibagu%C3%A9%2C+Tolima&d=Armenia%2C+Quind%C3%ADo&cat=II');
    await expect(page).toHaveURL(/index\.html\?o=Ibagu/);
    await expect(page.locator('#rSub')).toContainText('categoría II');
  });

  test('enlaces viejos ?peaje= de la portada van al mapa', async ({ page }) => {
    await page.goto('index.html?peaje=rio-frio');
    await expect(page).toHaveURL(/mapa\.html\?peaje=rio-frio/);
    await expect(page.locator('#detailSheet')).toBeVisible();
  });
});

test('@live la ruta real de Mapbox responde', async ({ page }) => {
  test.skip(!process.env.LIVE, 'solo con LIVE=1');
  await page.goto('index.html');
  await calcular(page, 'Cali, Valle del Cauca', 'Buenaventura, Valle del Cauca');
  const t = await leerTiquete(page);
  expect(t.filas.length).toBeGreaterThan(0);
});
