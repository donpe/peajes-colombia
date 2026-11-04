/* Integridad del dataset que publica el sitio (sin navegador). */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const leer = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'data', f), 'utf8'));
const peajes = leer('peajes_clean.json');
const municipios = leer('municipios.json');
const bbox = leer('departamentos_bbox.json');
const CATS = ['I', 'II', 'III', 'IV', 'V'];
/* Casos ya revisados contra el CSV de INVIAS (Peajes_20261017.csv): vienen así de la
   fuente y no hay resolución oficial a mano con la cifra correcta, así que no se tocan
   (scripts/aplicar_correcciones_tarifarias.py: "nunca se inventa un valor").
   Las pruebas fallan solo si aparece un caso NUEVO. */
const CONOCIDOS_SIN_CATEGORIA = [
  'tunia-siniestrada', 'la-nevera-no-operativo', 'aranguaney-no-operativo',   // no operan
  'los-santos', 'uribia',                                                     // INVIAS publica todo en 0
  'turbaco', 'unisabana',                                                     // solo cobran a vehículos grandes
  'corredor-portuario', 'quiebra-de-velez', 'la-estrella', 'bazurto-manga', 'ceballos',  // sin categoría III
];
const CONOCIDOS_INCOHERENTES = [
  'laureano-gomez',   // II = $1.200 en la fuente, entre I $10.100 y III $28.100: parece un cero perdido
  'macheta',          // III y IV $11.800, menos que II $20.500
];
const enColombia = (lat, lon) => lat > -4.3 && lat < 13.6 && lon > -82 && lon < -66.8;

test.describe('dataset', () => {
  test.skip(({ isMobile }) => isMobile, 'una sola vez');

  test('181 peajes con id único', () => {
    expect(peajes).toHaveLength(181);
    expect(new Set(peajes.map(p => p.id)).size).toBe(peajes.length);
  });

  test('coordenadas dentro de Colombia y de su departamento', () => {
    const fuera = peajes.filter(p => !enColombia(p.lat, p.lon)).map(p => p.id);
    expect(fuera).toEqual([]);
    const margen = 0.1;
    const fueraDepto = peajes.filter(p => {
      const b = bbox[p.departamento];
      return b && !(p.lon >= b[0] - margen && p.lon <= b[2] + margen && p.lat >= b[1] - margen && p.lat <= b[3] + margen);
    }).map(p => `${p.id} (${p.departamento})`);
    expect(fueraDepto).toEqual([]);
  });

  test('tarifas: números positivos, tarifa_cat1 = categoría I', () => {
    const malas = [];
    peajes.forEach(p => Object.entries(p.categorias || {}).forEach(([k, v]) => {
      if (v != null && !(Number.isFinite(v) && v > 0 && v < 1_000_000)) malas.push(`${p.id} ${k}=${v}`);
    }));
    expect(malas).toEqual([]);
    const distintas = peajes.filter(p => (p.categorias?.I ?? null) !== (p.tarifa_cat1 ?? null)).map(p => p.id);
    expect(distintas).toEqual([]);
  });

  test('las 5 categorías principales publicadas en cada peaje', () => {
    const incompletos = peajes.filter(p => !CONOCIDOS_SIN_CATEGORIA.includes(p.id) && CATS.some(c => p.categorias?.[c] == null)).map(p => `${p.id}: falta ${CATS.filter(c => p.categorias?.[c] == null).join(',')}`);
    expect(incompletos, 'peajes nuevos sin alguna categoría I–V').toEqual([]);
  });

  test('un vehículo más grande no paga menos que el automóvil', () => {
    const raros = peajes.filter(p => !CONOCIDOS_INCOHERENTES.includes(p.id) && CATS.slice(1).some(c => p.categorias?.[c] != null && p.categorias?.I != null && p.categorias[c] < p.categorias.I))
      .map(p => `${p.id}: ${CATS.map(c => p.categorias?.[c]).join(' / ')}`);
    expect(raros, 'tarifas nuevas donde un vehículo grande paga menos').toEqual([]);
  });

  test('peajes casi en el mismo punto (posibles duplicados)', () => {
    const dup = [];
    for (let i = 0; i < peajes.length; i++) for (let j = i + 1; j < peajes.length; j++) {
      const a = peajes[i], b = peajes[j];
      if (Math.abs(a.lat - b.lat) < 0.0005 && Math.abs(a.lon - b.lon) < 0.0005) dup.push(`${a.id} ~ ${b.id}`);
    }
    expect.soft(dup).toEqual([]);
  });

  test('campos obligatorios', () => {
    const faltan = peajes.filter(p => !p.nombre_display || !p.departamento || !p.operador_tipo).map(p => p.id);
    expect(faltan).toEqual([]);
    expect([...new Set(peajes.map(p => p.operador_tipo))].sort()).toEqual(['Concesión', 'INVIAS', 'Por definir']);
  });

  test('municipios: etiqueta única y coordenadas en Colombia', () => {
    const etq = municipios.map(m => `${m.n}, ${m.d}`);
    const repetidas = etq.filter((e, i) => etq.indexOf(e) !== i);
    expect(repetidas).toEqual([]);
    expect(municipios.filter(m => !enColombia(m.lat, m.lon)).map(m => m.n)).toEqual([]);
    expect(municipios.length).toBeGreaterThan(1000);
  });
});
