/* Mapa: filtros combinados, conteos, lista, ficha del peaje, foco y estado en la URL. */
const { test, expect } = require('./fixtures');

const n = async loc => +(await loc.textContent()).trim();

test.describe('mapa', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('mapa.html');
    await expect(page.locator('#sidebarCount')).toContainText('181 de 181 peajes');
  });

  test('conteos de los filtros cuadran con el total', async ({ page }) => {
    const inv = await n(page.locator('#chips [data-key="INVIAS"] .chip-n'));
    const conc = await n(page.locator('#chips [data-key="Concesión"] .chip-n'));
    expect(await n(page.locator('#chips [data-key="all"] .chip-n'))).toBe(181);
    const porDefinir = await page.evaluate(() => peajes.filter(p => p.operador_tipo === 'Por definir').length);
    expect(inv + conc + porDefinir).toBe(181);
    await expect(page.locator('#list .lista-item')).toHaveCount(181);
    const sumaDeptos = await page.$$eval('#deptoSelect option', os => os.slice(1).reduce((s, o) => s + +o.textContent.match(/\((\d+)\)/)[1], 0));
    expect(sumaDeptos).toBe(181);
  });

  test('filtro por operador: lista, aria-pressed y URL', async ({ page }) => {
    const chip = page.locator('#chips [data-key="INVIAS"]');
    const esperado = await n(chip.locator('.chip-n'));
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#list .lista-item')).toHaveCount(esperado);
    await expect(page).toHaveURL(/tipo=INVIAS/);
  });

  test('filtro por departamento acerca el mapa y cuenta bien', async ({ page }) => {
    const opt = await page.locator('#deptoSelect option[value="ANTIOQUIA"]').textContent();
    const esperado = +opt.match(/\((\d+)\)/)[1];
    const zoomAntes = await page.evaluate(() => map.getZoom());
    await page.locator('#deptoSelect').selectOption('ANTIOQUIA');
    await expect(page.locator('#list .lista-item')).toHaveCount(esperado);
    await expect(page).toHaveURL(/depto=ANTIOQUIA/);
    await expect.poll(() => page.evaluate(() => map.getZoom())).toBeGreaterThan(zoomAntes);
  });

  test('combinación sin resultados ofrece salir', async ({ page, isMobile }) => {
    if (isMobile) await page.locator('#listToggle').click();
    // se busca un departamento sin peajes de INVIAS
    await page.locator('#chips [data-key="INVIAS"]').click();
    const vacio = await page.$$eval('#deptoSelect option', os => (os.find(o => /\(0\)/.test(o.textContent)) || {}).value);
    test.skip(!vacio, 'todos los departamentos tienen peajes de INVIAS');
    await page.locator('#deptoSelect').selectOption(vacio);
    await expect(page.locator('#list .list-empty')).toContainText('No hay peajes de INVIAS');
    await page.locator('#clearType').click();
    await expect(page.locator('#chips [data-key="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#list .lista-item').first()).toBeVisible();
  });

  test('elegir un peaje de la lista abre la ficha; Escape la cierra y devuelve el foco', async ({ page, isMobile }) => {
    if (isMobile) await page.locator('#listToggle').click();
    const item = page.locator('#list .lista-item').first();
    const id = await item.getAttribute('data-id');
    const nombre = (await item.locator('.n').evaluate(e => e.childNodes[0].textContent)).trim();
    await item.click();
    await expect(page.locator('#detailSheet')).toBeVisible();
    await expect(page.locator('#detailName')).toHaveText(nombre);
    await expect(page.locator('#closeDetail')).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`peaje=${id}`));
    await expect(page.locator(`#list .lista-item[data-id="${id}"]`)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#detailSheet')).toBeHidden();
    await expect(page.locator(`#list .lista-item[data-id="${id}"]`)).toBeFocused();
    await expect(page).not.toHaveURL(/peaje=/);
  });

  test('cambiar el filtro cierra la ficha abierta', async ({ page, isMobile }) => {
    if (isMobile) await page.locator('#listToggle').click();
    await page.locator('#list .lista-item').first().click();
    await expect(page.locator('#detailSheet')).toBeVisible();
    await page.locator('#chips [data-key="Concesión"]').click();
    await expect(page.locator('#detailSheet')).toBeHidden();
    await expect(page).not.toHaveURL(/peaje=/);
  });

  test('cambiar de vehículo cambia las tarifas de la lista y la ficha', async ({ page, isMobile }) => {
    if (isMobile) await page.locator('#listToggle').click();
    await page.locator('#list .lista-item[data-id="rio-frio"]').click();
    await expect(page.locator('#detailContent .fila.on')).toContainText('I · ');
    await page.locator('.vehiculo label', { hasText: /^IV$/ }).click();
    await expect(page.locator('#sidebarCount')).toContainText('categoría IV');
    await expect(page.locator('#detailContent .fila.on')).toContainText('IV · ');
    await expect(page.locator('#list .lista-item[data-id="rio-frio"] .v')).toHaveText('$37.200');
  });
});

test.describe('mapa desde un enlace', () => {
  test('?peaje= abre la ficha de ese peaje', async ({ page }) => {
    await page.goto('mapa.html?peaje=rio-frio');
    await expect(page.locator('#detailSheet')).toBeVisible();
    await expect(page.locator('#detailName')).toHaveText('Río Frío');
    await expect(page.locator('#detailContent a.enlace')).toHaveAttribute('href', /invias\.gov\.co/);
  });

  test('?depto=&tipo= aplica los dos filtros', async ({ page }) => {
    await page.goto('mapa.html?depto=ANTIOQUIA&tipo=Concesi%C3%B3n');
    await expect(page.locator('#deptoSelect')).toHaveValue('ANTIOQUIA');
    await expect(page.locator('#chips [data-key="Concesión"]')).toHaveAttribute('aria-pressed', 'true');
    const esperado = await page.evaluate(() => peajes.filter(p => p.departamento === 'ANTIOQUIA' && p.operador_tipo === 'Concesión').length);
    await expect(page.locator('#list .lista-item')).toHaveCount(esperado);
  });

  test('valores inventados en la URL no rompen la página', async ({ page, errores }) => {
    await page.goto('mapa.html?depto=NARNIA&tipo=xx&peaje=no-existe');
    await expect(page.locator('#sidebarCount')).toContainText('181 de 181');
    await expect(page.locator('#detailSheet')).toBeHidden();
    expect(errores).toEqual([]);
  });

  test('en el teléfono la lista se despliega con el botón', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'solo en el teléfono');
    await page.goto('mapa.html');
    const btn = page.locator('#listToggle');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#list .lista-item').first()).toBeVisible();
  });
});
