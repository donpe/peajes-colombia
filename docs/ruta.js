/* Calculador de ruta — Peajes de Colombia
   Flujo: municipio origen/destino (autocompletado local) -> ruta real por
   Mapbox Directions -> cruce geométrico de la ruta contra los 179 peajes ->
   resumen y mapa. */

const money = n => n == null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
const OP_COLOR = { 'INVIAS': '#2f7d52', 'Concesión': '#d1495b', 'Por definir': '#8991b3' };

// Token público de Mapbox: está pensado para vivir en código de cliente
// (se restringe por dominio desde el dashboard de Mapbox, no ocultándolo).
const MAPBOX_TOKEN = 'pk.eyJ1IjoiZXZlbGlvcmFtaXJleiIsImEiOiJjbXU3aDRrcDIwaXMxMndwdTk2eWdlN2hsIn0.Uyd-HgsYhu7Zj6y5K8DLUQ';
// driving-traffic: usa tráfico en tiempo real para el tiempo estimado —
// más preciso que un perfil sin tráfico (ver limitación documentada en Acerca).
const MAPBOX_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic';
const MATCH_THRESHOLD_KM = 0.5;   // qué tan cerca de la ruta debe estar un peaje para contar
const MATCH_THRESHOLD_SIN_NOMBRE_KM = 0.15; // cuando no se puede verificar el nombre de vía (ver verificarPorNombreDeVia)
const DEDUP_ALONG_KM = 0.3;       // peajes a menos de esto entre sí (a lo largo de la ruta) se consideran el mismo cruce
// Solo para consultar el nombre real de una vía en una coordenada (OSRM
// /nearest hace snap al camino más cercano y devuelve su nombre de OSM).
// El ruteo en sí lo hace Mapbox; esto es una consulta auxiliar aparte.
const OSRM_NEAREST_URL = 'https://router.project-osrm.org/nearest/v1/driving';

let municipios = [];
let selOrigen = null;   // { n, d, lat, lon }
let selDestino = null;
let map, routeLayer, tollLayerGroup;
let tollMarkers = [];  // marcadores de peaje de la ruta activa, en el mismo orden que la lista
let rutasCalculadas = [];  // [{ ruta, matches }, ...] — todas las alternativas de la última búsqueda
let rutaActivaIdx = 0;

async function init() {
  const res = await fetch('data/municipios.json');
  municipios = await res.json();

  setupAutocomplete('inputOrigen', 'listOrigen', m => { selOrigen = m; });
  setupAutocomplete('inputDestino', 'listDestino', m => { selDestino = m; });

  document.getElementById('swapBtn').addEventListener('click', swapOrigenDestino);
  document.getElementById('calcBtn').addEventListener('click', calcularRuta);
  document.getElementById('catSelect').addEventListener('change', () => {
    // cambiar de categoría no requiere volver a pedir la ruta: ya tenemos
    // los peajes de cada alternativa, solo cambia qué tarifa se suma.
    if (rutasCalculadas.length) { renderRouteOptions(); mostrarResultados(); }
  });
  document.getElementById('avoidTolls').addEventListener('change', () => {
    // esto sí cambia la ruta en sí (no solo el total), así que hay que
    // volver a pedirla — solo si ya había una búsqueda hecha.
    if (selOrigen && selDestino) calcularRuta();
  });
}

/* ---------------- autocompletado ---------------- */

function normaliza(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function buscarMunicipios(q) {
  const nq = normaliza(q.trim());
  if (!nq) return [];
  const starts = [];
  const contains = [];
  municipios.forEach(m => {
    const nn = normaliza(m.n);
    if (nn.startsWith(nq)) starts.push(m);
    else if (nn.includes(nq)) contains.push(m);
  });
  return [...starts, ...contains].slice(0, 8);
}

function setupAutocomplete(inputId, listId, onSelect) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  let items = [];
  let hlIndex = -1;

  function render() {
    if (!items.length) {
      list.innerHTML = `<div class="ac-empty">Sin resultados</div>`;
      list.hidden = false;
      return;
    }
    list.innerHTML = items.map((m, i) => `
      <div class="ac-item${i === hlIndex ? ' hl' : ''}" data-i="${i}">
        <b>${m.n}</b><span>${m.d}</span>
      </div>`).join('');
    list.hidden = false;
    [...list.children].forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        select(items[+el.dataset.i]);
      });
    });
  }

  function select(m) {
    input.value = `${m.n}, ${m.d}`;
    onSelect(m);
    list.hidden = true;
    items = [];
  }

  input.addEventListener('input', () => {
    onSelect(null);
    items = buscarMunicipios(input.value);
    hlIndex = -1;
    if (input.value.trim()) render(); else list.hidden = true;
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); hlIndex = Math.min(hlIndex + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hlIndex = Math.max(hlIndex - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hlIndex >= 0) select(items[hlIndex]); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });

  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
}

function swapOrigenDestino() {
  const inO = document.getElementById('inputOrigen');
  const inD = document.getElementById('inputDestino');
  [selOrigen, selDestino] = [selDestino, selOrigen];
  [inO.value, inD.value] = [inD.value, inO.value];
}

/* ---------------- geometría ---------------- */

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Proyección local equirectangular (km), suficiente a la escala de una ruta.
function projector(lat0) {
  const cosLat = Math.cos(lat0 * Math.PI / 180);
  return (lat, lon) => [lon * 111.32 * cosLat, lat * 110.57];
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return { d: Math.hypot(px - ax, py - ay), t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { d: Math.hypot(px - cx, py - cy), t };
}

/* Encuentra los peajes que caen sobre una ruta (lista de [lat,lon]) y su
   distancia acumulada ("along", en km) desde el origen. */
function peajesEnRuta(routeLatLon, peajes) {
  const lat0 = routeLatLon[Math.floor(routeLatLon.length / 2)][0];
  const proj = projector(lat0);
  const pts = routeLatLon.map(([lat, lon]) => proj(lat, lon));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }

  const lats = routeLatLon.map(p => p[0]), lons = routeLatLon.map(p => p[1]);
  const bbox = [Math.min(...lons) - 0.05, Math.min(...lats) - 0.05, Math.max(...lons) + 0.05, Math.max(...lats) + 0.05];

  const found = [];
  peajes.forEach(p => {
    if (p.lat == null || p.lon == null) return;
    if (p.lon < bbox[0] || p.lon > bbox[2] || p.lat < bbox[1] || p.lat > bbox[3]) return;
    const [px, py] = proj(p.lat, p.lon);
    let best = Infinity, bestAlong = 0, bestPoint = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const { d, t } = distPointToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < best) {
        best = d;
        const segLen = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        bestAlong = cum[i] + t * segLen;
        // punto de la ruta más cercano, en lat/lon (interpolación lineal —
        // suficiente a esta escala) — se usa para verificar el nombre de vía.
        bestPoint = [
          routeLatLon[i][0] + t * (routeLatLon[i + 1][0] - routeLatLon[i][0]),
          routeLatLon[i][1] + t * (routeLatLon[i + 1][1] - routeLatLon[i][1]),
        ];
      }
    }
    if (best <= MATCH_THRESHOLD_KM) found.push({ peaje: p, distRuta: best, along: bestAlong, puntoRuta: bestPoint });
  });

  found.sort((a, b) => a.along - b.along);

  // dedup: si dos peajes caen casi en el mismo punto de la ruta (ej. los dos
  // sentidos de un mismo cruce), se queda el más cercano a la línea de la ruta.
  const dedup = [];
  found.forEach(f => {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.abs(f.along - prev.along) < DEDUP_ALONG_KM) {
      if (f.distRuta < prev.distRuta) dedup[dedup.length - 1] = f;
    } else {
      dedup.push(f);
    }
  });

  return dedup;
}

/* Un peaje puede caer geométricamente cerca de la ruta (dentro del margen)
   sin estar realmente sobre la vía que la ruta usa — pasa cuando dos vías
   corren en paralelo muy cerca una de otra (ej. la Autopista Norte y la
   Carretera Central del Norte cerca de Chía; o un túnel nuevo bajo una vía
   de montaña vieja, como Santa Elena/Sajonia). La distancia geométrica sola
   no alcanza para distinguirlo: se comprobó que el "falso positivo" y una
   coincidencia real pueden estar a una distancia parecida de la ruta.

   Se verifica el nombre real de la vía en dos puntos — el del peaje, y el
   punto de la ruta más cercano a él — usando OSRM /nearest (que hace snap
   al camino más cercano en OpenStreetMap y devuelve su nombre). Si ambos
   nombres existen y son distintos, es una vía distinta -> se descarta.

   Si alguno de los dos no tiene nombre en OSM (pasa con nodos de peaje que
   no están anclados a ninguna vía, ej. Unisabana), el nombre no sirve para
   decidir. En ese caso se usa una regla de distancia más estricta
   (MATCH_THRESHOLD_SIN_NOMBRE_KM en vez de MATCH_THRESHOLD_KM): un peaje
   verificado por nombre puede estar hasta 500m de la ruta (autopistas con
   calzadas separadas), pero uno que no se pudo verificar solo se acepta si
   está muy pegado a la línea de la ruta (<150m) — si no, es más probable
   que sea un peaje de una vía cercana pero distinta que una coincidencia
   real sin nombre. Se vio con Unisabana: a 314m de la ruta, misma magnitud
   que Fusca (376m, vía distinta confirmada), muy lejos para confiar en la
   distancia sola. */
async function verificarPorNombreDeVia(candidatos) {
  const verificados = await Promise.all(candidatos.map(async c => {
    try {
      const [nombrePeaje, nombreRuta] = await Promise.all([
        nombreDeViaEn(c.peaje.lat, c.peaje.lon),
        nombreDeViaEn(c.puntoRuta[0], c.puntoRuta[1]),
      ]);
      if (nombrePeaje && nombreRuta) {
        return nombrePeaje === nombreRuta ? c : null;
      }
      // no se pudo verificar por nombre: exigir mayor cercanía geométrica
      return c.distRuta <= MATCH_THRESHOLD_SIN_NOMBRE_KM ? c : null;
    } catch (e) {
      // si el chequeo falla (red, timeout), tampoco se pudo verificar
      return c.distRuta <= MATCH_THRESHOLD_SIN_NOMBRE_KM ? c : null;
    }
  }));
  return verificados.filter(Boolean);
}

async function nombreDeViaEn(lat, lon) {
  const res = await fetch(`${OSRM_NEAREST_URL}/${lon},${lat}`);
  const data = await res.json();
  return normaliza((data.waypoints?.[0]?.name || '').trim()) || null;
}

/* ---------------- ruteo (Mapbox Directions) ---------------- */

// Pide alternativas: en muchos pares origen/destino hay más de una vía
// razonable (ej. Medellín-Bogotá tiene una ruta corta y una más larga por
// otro corredor), y cada una puede pasar por peajes distintos.
// exclude=toll (opcional, activado por el usuario) evita vías de peaje
// donde Mapbox tiene ese dato — no siempre coincide 1:1 con nuestro
// inventario de INVIAS, pero en la práctica cambia la ruta de forma real.
//
// Nota sobre precisión del cruce ruta↔peaje: se probó (y se descartó, ver
// commit anterior) verificar cada coincidencia contra el nombre real de la
// vía en ese punto, para filtrar casos donde un peaje de una vía distinta
// cae cerca de la ruta en el plano (ej. un túnel pasando por debajo de una
// vía de montaña vieja). Ese chequeo resolvía ese caso puntual, pero
// también descartaba peajes correctos en autopistas divididas, donde la
// garita puede estar a 200-400m del trazado de la ruta aunque sea la misma
// vía. Sigue como limitación conocida (ver Acerca) independientemente del
// proveedor de ruteo usado.
async function obtenerRutas(origen, destino, evitarPeajes) {
  const params = new URLSearchParams({
    alternatives: 'true',
    overview: 'full',
    geometries: 'geojson',
    access_token: MAPBOX_TOKEN,
  });
  if (evitarPeajes) params.set('exclude', 'toll');
  const url = `${MAPBOX_URL}/${origen.lon},${origen.lat};${destino.lon},${destino.lat}?${params}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.code !== 'Ok' || !data.routes || !data.routes.length) {
    if (data.code === 'NoRoute' || data.code === 'NoSegment') {
      throw new Error('No se encontró una ruta por carretera entre esos dos puntos.');
    }
    throw new Error(data.message || 'El servicio de ruteo no respondió correctamente.');
  }
  return data.routes.map(r => ({
    distanceKm: r.distance / 1000,
    durationH: r.duration / 3600,
    latlon: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
  }));
}

/* ---------------- filtrar alternativas que no son reales ---------------- */

// Mapbox suele devolver "alternativas" que en realidad son la misma vía con
// una variación de calles dentro de la ciudad de origen o destino — no una
// alternativa real de carretera. Una alterna solo se muestra si:
//   1) cambia el conjunto o el costo de los peajes, O
//   2) la distancia o el tiempo difieren de forma significativa,
// Y ADEMÁS su trazado no es casi idéntico al de la recomendada en la parte
// de carretera (si comparten la enorme mayoría del camino, el "cambio" de
// arriba viene solo de un desvío local, no de una ruta distinta).
const MIN_DIST_DIFF_KM = 8;
const MIN_DIST_DIFF_PCT = 0.08;
const MIN_DURATION_DIFF_MIN = 10;
const MAX_SOLAPAMIENTO = 0.85;   // 85% del trazado en común -> no es una alternativa real
const OVERLAP_SAMPLE_KM = 1;
const OVERLAP_MATCH_KM = 0.25;

function totalCategoriaI(matches) {
  return matches.reduce((sum, m) => sum + (m.peaje.categorias?.I ?? 0), 0);
}

function mismoConjuntoDePeajes(a, b) {
  const idsA = a.map(m => m.peaje.id).sort().join('|');
  const idsB = b.map(m => m.peaje.id).sort().join('|');
  return idsA === idsB;
}

// Fracción (0-1) del trazado de `latlon` que pasa a menos de OVERLAP_MATCH_KM
// del trazado `base` — reusa la misma proyección/distancia punto-segmento
// que el cruce ruta↔peaje. projector() da coordenadas en km (ver
// MATCH_THRESHOLD_KM más arriba), no en metros.
function fraccionSolapada(latlon, base) {
  const lat0 = base[Math.floor(base.length / 2)][0];
  const proj = projector(lat0);
  const basePts = base.map(([lat, lon]) => proj(lat, lon));

  const pts = latlon.map(([lat, lon]) => proj(lat, lon));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const totalKm = cum[cum.length - 1];
  if (totalKm === 0) return 1;

  let dentro = 0, muestras = 0;
  for (let d = 0; d <= totalKm; d += OVERLAP_SAMPLE_KM) {
    let i = cum.findIndex(c => c >= d);
    if (i <= 0) i = 1;
    const [px, py] = pts[i - 1];
    let best = Infinity;
    for (let j = 0; j < basePts.length - 1; j++) {
      const { d: dd } = distPointToSegment(px, py, basePts[j][0], basePts[j][1], basePts[j + 1][0], basePts[j + 1][1]);
      if (dd < best) best = dd;
    }
    muestras++;
    if (best <= OVERLAP_MATCH_KM) dentro++;
  }
  return muestras ? dentro / muestras : 1;
}

function esAlternativaReal(base, alt) {
  const distDiffKm = Math.abs(alt.ruta.distanceKm - base.ruta.distanceKm);
  const distDiffPct = base.ruta.distanceKm ? distDiffKm / base.ruta.distanceKm : 0;
  const durDiffMin = Math.abs(alt.ruta.durationH - base.ruta.durationH) * 60;
  const difierenTiempoDistancia = distDiffKm >= MIN_DIST_DIFF_KM || distDiffPct >= MIN_DIST_DIFF_PCT || durDiffMin >= MIN_DURATION_DIFF_MIN;

  const difierenPeajes = totalCategoriaI(base.matches) !== totalCategoriaI(alt.matches) ||
    !mismoConjuntoDePeajes(base.matches, alt.matches);

  if (!difierenTiempoDistancia && !difierenPeajes) return false;

  const solapamiento = fraccionSolapada(alt.ruta.latlon, base.ruta.latlon);
  return solapamiento < MAX_SOLAPAMIENTO;
}

function filtrarAlternativasReales(rutas) {
  if (rutas.length < 2) return rutas;
  const [base, ...resto] = rutas;
  return [base, ...resto.filter(alt => esAlternativaReal(base, alt))];
}

/* ---------------- flujo principal ---------------- */

async function calcularRuta() {
  const status = document.getElementById('routeStatus');
  const btn = document.getElementById('calcBtn');
  status.hidden = false;
  status.className = 'route-status';

  if (!selOrigen || !selDestino) {
    status.textContent = 'Elige un origen y un destino de la lista de sugerencias.';
    status.className = 'route-status error';
    return;
  }
  if (selOrigen.n === selDestino.n && selOrigen.d === selDestino.d) {
    status.textContent = 'El origen y el destino son el mismo municipio.';
    status.className = 'route-status error';
    return;
  }

  btn.disabled = true;
  status.textContent = 'Calculando ruta…';

  try {
    const evitarPeajes = document.getElementById('avoidTolls').checked;
    const [peajesRes, rutas] = await Promise.all([
      fetch('data/peajes_clean.json').then(r => r.json()),
      obtenerRutas(selOrigen, selDestino, evitarPeajes),
    ]);

    status.textContent = 'Verificando peajes en el camino…';
    const todasLasRutas = await Promise.all(rutas.map(async ruta => {
      const candidatos = peajesEnRuta(ruta.latlon, peajesRes);
      const matches = await verificarPorNombreDeVia(candidatos);
      return { ruta, matches };
    }));
    rutasCalculadas = filtrarAlternativasReales(todasLasRutas);
    rutaActivaIdx = 0;
    renderRouteOptions();
    mostrarResultados();
    status.hidden = true;
  } catch (err) {
    status.textContent = err.message || 'No se pudo calcular la ruta. Intenta de nuevo.';
    status.className = 'route-status error';
  } finally {
    btn.disabled = false;
  }
}

function seleccionarRuta(idx) {
  rutaActivaIdx = idx;
  renderRouteOptions();
  mostrarResultados();
}

/* No se etiqueta ninguna ruta como "recomendada": Mapbox ordena sus
   alternativas solo por tiempo de viaje, sin tener en cuenta el costo de
   peajes, así que ese orden no es necesariamente lo que le conviene a
   quien maneja (puede ahorrar 20 min y costar $70.000 más). En vez de
   heredar ese orden como jerarquía, se muestran todas las rutas con las
   mismas cifras (tiempo, distancia, peajes, costo) y una insignia objetiva
   por cada métrica en la que una ruta es la mejor — quien la usa decide
   el trade-off, no la app por su cuenta. */
function renderRouteOptions() {
  const el = document.getElementById('routeOptions');
  if (rutasCalculadas.length < 2) { el.hidden = true; el.innerHTML = ''; return; }

  const cat = document.getElementById('catSelect').value;
  const stats = rutasCalculadas.map(({ ruta, matches }) => {
    const conTarifa = matches.filter(m => m.peaje.categorias && m.peaje.categorias[cat] != null);
    return { conTarifa, total: conTarifa.reduce((sum, m) => sum + m.peaje.categorias[cat], 0) };
  });
  const minDuracion = Math.min(...rutasCalculadas.map(r => r.ruta.durationH));
  const minTotal = Math.min(...stats.map(s => s.total));
  const minPeajes = Math.min(...stats.map(s => s.conTarifa.length));

  el.hidden = false;
  el.innerHTML = rutasCalculadas.map(({ ruta }, i) => {
    const { conTarifa, total } = stats[i];
    const badges = [];
    if (ruta.durationH === minDuracion) badges.push('Más rápida');
    if (total === minTotal) badges.push('Más barata');
    if (conTarifa.length === minPeajes) badges.push('Menos peajes');
    return `
      <button class="route-option${i === rutaActivaIdx ? ' active' : ''}" data-i="${i}">
        <span class="route-option-label">Ruta ${i + 1}</span>
        <span class="route-option-badges">${badges.map(b => `<span class="route-badge">${b}</span>`).join('')}</span>
        <span class="route-option-stats">${ruta.distanceKm.toFixed(0)} km · ~${formatDuracion(ruta.durationH)} · ${conTarifa.length} peaje${conTarifa.length === 1 ? '' : 's'} · $${money(total)}</span>
      </button>`;
  }).join('');
  [...el.children].forEach(btn => btn.addEventListener('click', () => seleccionarRuta(+btn.dataset.i)));
}

function catLabel(cat) {
  return { I: 'Automóvil', II: 'Bus / 2 ejes', III: 'Camión 3 ejes', IV: 'Camión 4 ejes', V: 'Camión 5+ ejes' }[cat] || cat;
}

function mostrarResultados() {
  const { ruta, matches } = rutasCalculadas[rutaActivaIdx];
  document.getElementById('resultsWrap').hidden = false;
  const cat = document.getElementById('catSelect').value;

  const conTarifa = matches.filter(m => m.peaje.categorias && m.peaje.categorias[cat] != null);
  const total = conTarifa.reduce((sum, m) => sum + m.peaje.categorias[cat], 0);

  const kpis = [
    { v: ruta.distanceKm.toFixed(0) + ' km', l: 'Distancia' },
    { v: '~' + formatDuracion(ruta.durationH), l: 'Tiempo (sin tráfico)', muted: true,
      title: 'Estimado por el motor de ruteo sin datos de tráfico real. En vías de montaña puede diferir bastante de lo que muestra Google Maps.' },
    { v: conTarifa.length, l: 'Peajes en la ruta' },
    { v: '$' + money(total), l: `Total categoría ${cat}` },
  ];
  document.getElementById('routeKpis').innerHTML = kpis.map(k =>
    `<div class="kpi${k.muted ? ' kpi-muted' : ''}"${k.title ? ` title="${k.title}"` : ''}><b>${k.v}</b><span>${k.l}</span></div>`
  ).join('');

  document.getElementById('tollsSub').textContent =
    `${selOrigen.n} → ${selDestino.n} · Categoría ${cat} (${catLabel(cat)})`;

  const tollsList = document.getElementById('tollsList');
  if (!matches.length) {
    tollsList.innerHTML = `<div class="ac-empty">No se detectaron peajes en esta ruta.</div>`;
  } else {
    tollsList.innerHTML = matches.map((m, i) => {
      const tarifa = m.peaje.categorias ? m.peaje.categorias[cat] : null;
      return `
      <div class="rank-row rank-row-clickable${tarifa == null ? ' rank-row-muted' : ''}" data-i="${i}">
        <span class="rank-pos">${i + 1}</span>
        <span class="rank-name">${m.peaje.nombre_display}
          <div class="rank-sub">km ${m.along.toFixed(0)} · ${m.peaje.operador || 'Operador no definido'}</div>
        </span>
        <span class="rank-val">${tarifa != null ? '$' + money(tarifa) : 'No aplica a esta categoría'}</span>
      </div>`;
    }).join('');
  }

  renderMapa(ruta, matches);

  // clic en un peaje de la lista -> lo centra en el mapa y abre su ficha
  // (los marcadores ya existen porque renderMapa() acaba de crearlos)
  tollsList.querySelectorAll('.rank-row-clickable').forEach(el => {
    el.addEventListener('click', () => irAPeajeEnMapa(+el.dataset.i));
  });
}

function formatDuracion(h) {
  const horas = Math.floor(h);
  const min = Math.round((h - horas) * 60);
  if (horas === 0) return `${min} min`;
  return `${horas} h ${min} min`;
}

function renderMapa(ruta, matches) {
  if (!map) {
    map = L.map('routeMap', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    tollLayerGroup = L.layerGroup().addTo(map);
  }
  routeLayer.clearLayers();
  tollLayerGroup.clearLayers();

  const line = L.polyline(ruta.latlon, { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), weight: 4, opacity: 0.85 });
  routeLayer.addLayer(line);

  const startIcon = endpointIcon('#2f7d52', 'A');
  const endIcon = endpointIcon('#d1495b', 'B');
  routeLayer.addLayer(L.marker(ruta.latlon[0], { icon: startIcon }));
  routeLayer.addLayer(L.marker(ruta.latlon[ruta.latlon.length - 1], { icon: endIcon }));

  const cat = document.getElementById('catSelect').value;
  tollMarkers = matches.map((m, i) => {
    const color = OP_COLOR[m.peaje.operador_tipo] || OP_COLOR['Por definir'];
    const marker = L.marker([m.peaje.lat, m.peaje.lon], { icon: tollIcon(i + 1, color) });
    marker.bindPopup(popupHtml(m.peaje, m.along, cat), { maxWidth: 260 });
    tollLayerGroup.addLayer(marker);
    return marker;
  });

  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
  }, 50);
}

// Lleva el mapa al peaje elegido en la lista y abre su ficha — mismo gesto
// que seleccionar un peaje en la lista del Mapa.
function irAPeajeEnMapa(i) {
  const marker = tollMarkers[i];
  if (!map || !marker) return;
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13), { animate: true });
  marker.openPopup();
}

// Misma estructura que el popup del Mapa (app.js): nombre, operador, tarifa —
// con el km de la ruta como línea extra, propia de este contexto.
function popupHtml(p, along, cat) {
  const tarifa = p.categorias ? p.categorias[cat] : null;
  return `<div style="font-family:'Outfit',sans-serif;font-size:13px;min-width:180px">
    <div style="font-weight:700;font-family:'Outfit',sans-serif;font-size:15px">${p.nombre_display}</div>
    <div style="color:#666;margin:2px 0 6px">${p.operador || 'Operador no definido'}</div>
    <div style="font-family:'Roboto Mono',monospace;font-weight:600">Categoría ${cat}: ${tarifa != null ? '$' + money(tarifa) : '—'}</div>
    <div style="color:#888;font-size:12px;margin-top:4px">km ${along.toFixed(0)} de la ruta</div>
  </div>`;
}

function endpointIcon(color, letter) {
  return L.divIcon({
    className: '',
    html: `<div style="width:24px;height:24px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-family:Outfit,sans-serif;font-weight:700;font-size:12px">${letter}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Mismo pin (forma de gota) que usan los peajes en el Mapa — coloreado por
// tipo de operador, igual que allá — pero con el número de orden en la ruta
// en vez de "$", porque aquí ese orden es la información relevante.
function tollIcon(n, color) {
  const svg = `
    <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0.5C6.1 0.5 0.5 6.1 0.5 13c0 9.2 12.5 20 12.5 20s12.5-10.8 12.5-20C25.5 6.1 19.9 0.5 13 0.5z"
            fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="13" cy="13" r="7" fill="#fff"/>
      <text x="13" y="17.5" text-anchor="middle" font-family="'Roboto Mono', monospace"
            font-weight="700" font-size="11" fill="${color}">${n}</text>
    </svg>`;
  return L.divIcon({
    className: 'peaje-pin',
    html: svg,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });
}

init();
