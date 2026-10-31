/* Calculador de ruta — Peajes de Colombia
   Flujo: municipio origen/destino (autocompletado local) -> ruta real por
   Mapbox Directions -> cruce geométrico de la ruta contra el inventario de peajes ->
   resumen y mapa. */

const { fmt, tc } = Peajes;

const { MAPBOX_TOKEN } = Peajes;
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
let map, routeLayer, tollLayerGroup, fondoLayer;
let inventario = [];   // los peajes, cargados una vez al abrir la página
let tollMarkers = [];  // marcadores de peaje de la ruta activa, en el mismo orden que la lista
let peajeActivo = -1;  // peaje elegido en el tiquete o en el mapa (índice en matches)
let rutasCalculadas = [];  // [{ ruta, matches }, ...] — todas las alternativas de la última búsqueda
let rutaActivaIdx = 0;

async function init() {
  const [resM, resP] = await Promise.all([fetch('data/municipios.json'), fetch('data/peajes_clean.json')]);
  municipios = await resM.json();
  inventario = (await resP.json()).filter(p => p.lat != null && p.lon != null);
  iniciarMapa();
  pintarLeyenda();

  setupAutocomplete('inputOrigen', 'listOrigen', m => { selOrigen = m; });
  setupAutocomplete('inputDestino', 'listDestino', m => { selDestino = m; });

  document.getElementById('swapBtn').addEventListener('click', swapOrigenDestino);
  document.getElementById('routeForm').addEventListener('submit', e => { e.preventDefault(); calcularRuta(); });
  document.addEventListener('peajes:cat', () => {
    // cambiar de vehículo no requiere volver a pedir la ruta: ya tenemos
    // los peajes de cada alternativa, solo cambia qué tarifa se suma.
    if (rutasCalculadas.length) { renderRouteOptions(); mostrarResultados({ encuadrar: false }); guardarEstadoEnUrl(); }
  });
  // ejemplos de un clic: llenan origen y destino y calculan
  document.querySelectorAll('#ejemplos button').forEach(b => b.addEventListener('click', () => {
    selOrigen = buscarPorEtiqueta(b.dataset.o); selDestino = buscarPorEtiqueta(b.dataset.d);
    document.getElementById('inputOrigen').value = selOrigen ? etiqueta(selOrigen) : '';
    document.getElementById('inputDestino').value = selDestino ? etiqueta(selDestino) : '';
    calcularRuta();
  }));
  document.getElementById('avoidTolls').addEventListener('change', () => {
    // esto sí cambia la ruta en sí (no solo el total), así que hay que
    // volver a pedirla — solo si ya había una búsqueda hecha.
    if (selOrigen && selDestino) calcularRuta();
  });

  // una ruta compartida (?o=…&d=…&cat=…&evitar=1) se calcula al abrir la página
  const q = new URLSearchParams(location.search);
  const o = buscarPorEtiqueta(q.get('o')), d = buscarPorEtiqueta(q.get('d'));
  if (q.get('evitar') === '1') document.getElementById('avoidTolls').checked = true;
  if (o) { selOrigen = o; document.getElementById('inputOrigen').value = etiqueta(o); }
  if (d) { selDestino = d; document.getElementById('inputDestino').value = etiqueta(d); }
  if (o && d) calcularRuta();
}

/* ---------------- estado en la URL ---------------- */

const etiqueta = m => `${m.n}, ${m.d}`;

function buscarPorEtiqueta(txt) {
  if (!txt) return null;
  const nt = normaliza(txt);
  return municipios.find(m => normaliza(etiqueta(m)) === nt) || null;
}

function guardarEstadoEnUrl() {
  const q = new URLSearchParams();
  if (selOrigen) q.set('o', etiqueta(selOrigen));
  if (selDestino) q.set('d', etiqueta(selDestino));
  q.set('cat', Peajes.cat);
  if (document.getElementById('avoidTolls').checked) q.set('evitar', '1');
  history.replaceState(null, '', `?${q}`);
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

  // combobox ARIA: el foco se queda en el input y la opción resaltada se
  // anuncia con aria-activedescendant
  function setOpen(open) {
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) input.removeAttribute('aria-activedescendant');
  }

  function render() {
    if (!items.length) {
      list.innerHTML = `<li class="ac-empty" role="option" aria-disabled="true">Sin resultados. Revisa la ortografía o prueba con otro municipio.</li>`;
      setOpen(true);
      return;
    }
    list.innerHTML = items.map((m, i) => `
      <li class="ac-item" role="option" id="${listId}-${i}" aria-selected="${i === hlIndex}" data-i="${i}">
        <b>${m.n}</b><span>${m.d}</span>
      </li>`).join('');
    setOpen(true);
    if (hlIndex >= 0) {
      input.setAttribute('aria-activedescendant', `${listId}-${hlIndex}`);
      document.getElementById(`${listId}-${hlIndex}`).scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
    [...list.children].forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        select(items[+el.dataset.i]);
      });
    });
  }

  function select(m) {
    input.value = etiqueta(m);
    onSelect(m);
    setOpen(false);
    items = [];
  }

  input.addEventListener('input', () => {
    onSelect(null);
    items = buscarMunicipios(input.value);
    hlIndex = -1;
    if (input.value.trim()) render(); else setOpen(false);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); hlIndex = Math.min(hlIndex + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hlIndex = Math.max(hlIndex - 1, 0); render(); }
    // Enter sin opción resaltada toma la primera sugerencia (con la lista
    // cerrada, Enter envía el formulario y calcula la ruta)
    else if (e.key === 'Enter') { e.preventDefault(); select(items[Math.max(hlIndex, 0)]); }
    else if (e.key === 'Escape') { setOpen(false); }
  });

  input.addEventListener('blur', () => setTimeout(() => setOpen(false), 120));
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
    if (best > MATCH_THRESHOLD_KM) return;
    // Peajes que cobran en un solo sentido (Túnel de La Línea): en doble
    // calzada la ruta pasa a pocos metros de la estación del sentido
    // contrario, así que solo cuenta si la ruta circula con ese rumbo.
    if (p.cobra_en_sentido && !mismoSentido(rumboEnRuta(pts, cum, bestAlong), p.cobra_en_sentido.rumbo_grados)) return;
    found.push({ peaje: p, distRuta: best, along: bestAlong, puntoRuta: bestPoint });
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

// Rumbo (0-360°, 0 = norte) de la ruta alrededor de la distancia `along`,
// medido entre puntos ~200 m antes y después para no depender de un solo
// segmento corto.
function rumboEnRuta(pts, cum, along) {
  const puntoEn = d => {
    const dd = Math.max(0, Math.min(d, cum[cum.length - 1]));
    let i = cum.findIndex(c => c >= dd);
    if (i <= 0) return pts[0];
    const t = (dd - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
  };
  const [ax, ay] = puntoEn(along - 0.2), [bx, by] = puntoEn(along + 0.2);
  return (Math.atan2(bx - ax, by - ay) * 180 / Math.PI + 360) % 360;
}

function mismoSentido(rumbo, rumboCobro) {
  const diff = Math.abs(((rumbo - rumboCobro) % 360 + 540) % 360 - 180);
  return diff < 90;
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
  status.className = 'route-status';

  if (!selOrigen || !selDestino) {
    status.textContent = 'Elige un origen y un destino de la lista de sugerencias.';
    status.className = 'route-status error';
    document.getElementById(selOrigen ? 'inputDestino' : 'inputOrigen').focus();
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
    const rutas = await obtenerRutas(selOrigen, selDestino, evitarPeajes);

    status.textContent = 'Verificando peajes en el camino…';
    const todasLasRutas = await Promise.all(rutas.map(async ruta => {
      const candidatos = peajesEnRuta(ruta.latlon, inventario);
      const matches = await verificarPorNombreDeVia(candidatos);
      return { ruta, matches };
    }));
    rutasCalculadas = filtrarAlternativasReales(todasLasRutas);
    rutaActivaIdx = 0;
    renderRouteOptions();
    mostrarResultados();
    guardarEstadoEnUrl();
    const n = rutasCalculadas.length;
    status.textContent = n > 1 ? `Hay ${n} rutas posibles; elige una para ver sus peajes.` : '';
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
function statsDe(matches, cat) {
  const conTarifa = matches.filter(m => m.peaje.categorias && m.peaje.categorias[cat] != null);
  return { conTarifa, total: conTarifa.reduce((sum, m) => sum + m.peaje.categorias[cat], 0) };
}

function renderRouteOptions() {
  const el = document.getElementById('routeOptions');
  if (rutasCalculadas.length < 2) { el.hidden = true; el.innerHTML = ''; return; }

  const cat = Peajes.cat;
  const stats = rutasCalculadas.map(({ matches }) => statsDe(matches, cat));
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
      <button type="button" class="route-option" aria-pressed="${i === rutaActivaIdx}" data-i="${i}">
        <b>Ruta ${i + 1} · ${fmt(total)}</b>
        <small>${ruta.distanceKm.toFixed(0)} km · ~${formatDuracion(ruta.durationH)} · ${conTarifa.length} peaje${conTarifa.length === 1 ? '' : 's'}</small>
        <span class="route-badges">${badges.map(b => `<span class="route-badge">${b}</span>`).join('')}</span>
      </button>`;
  }).join('');
  [...el.children].forEach(btn => btn.addEventListener('click', () => seleccionarRuta(+btn.dataset.i)));
}

function mostrarResultados({ encuadrar = true } = {}) {
  const { ruta, matches } = rutasCalculadas[rutaActivaIdx];
  const cat = Peajes.cat;
  const { conTarifa, total } = statsDe(matches, cat);
  if (encuadrar) peajeActivo = -1;   // ruta nueva: nada elegido
  document.getElementById('resultsWrap').hidden = false;

  document.getElementById('rTitulo').textContent = `${selOrigen.n} → ${selDestino.n}`;
  document.getElementById('rTotal').textContent = fmt(total);
  document.getElementById('rSub').textContent =
    `${ruta.distanceKm.toFixed(0)} km · ~${formatDuracion(ruta.durationH)} con tráfico · ${conTarifa.length} peaje${conTarifa.length === 1 ? '' : 's'} · categoría ${cat}`;

  pintarTiquete(ruta, matches, cat, total);
  renderMapa(ruta, matches, encuadrar);
}

/* El tiquete es también la ruta: una vía vertical de origen (arriba) a destino
   (abajo), con cada peaje como su número sobre la vía, el mismo del mapa. */
function pintarTiquete(ruta, matches, cat, total) {
  const filas = matches.map((m, i) => {
    const tarifa = m.peaje.categorias ? m.peaje.categorias[cat] : null;
    const sentido = m.peaje.cobra_en_sentido ? ` · cobra solo ${m.peaje.cobra_en_sentido.descripcion}` : '';
    return `<button type="button" class="fila${tarifa == null ? ' sin' : ''}${i === peajeActivo ? ' on' : ''}" data-i="${i}">
      <span class="nro">${i + 1}</span>
      <span class="nm">${tc(m.peaje.nombre_display)}<small>km ${m.along.toFixed(0)}${m.peaje.departamento ? ' · ' + tc(m.peaje.departamento) : ''}${sentido}</small></span>
      <span class="v">${tarifa != null ? fmt(tarifa) : 'no aplica'}</span></button>`;
  }).join('');
  const parada = (nombre, km) => `<div class="parada"><span class="cuadro"></span><span class="nm">${nombre}<small>km ${km}</small></span></div>`;
  const el = document.getElementById('tiquete');
  el.innerHTML = `
    <header><h2>${selOrigen.n} → ${selDestino.n}</h2>Categoría ${cat} · ${Peajes.CAT[cat]}</header>
    <div class="trayecto">
      ${parada(selOrigen.n, 0)}
      ${filas || '<p class="pie">No se detectaron peajes en esta ruta.</p>'}
      ${parada(selDestino.n, ruta.distanceKm.toFixed(0))}
    </div>
    <div class="total"><span>Total</span><span>${fmt(total)}</span></div>
    <p class="pie">Tarifas vigentes 2026 · incluyen el aporte al Fosevi</p>`;
  el.querySelectorAll('button.fila').forEach(b => b.addEventListener('click', () => irAPeajeEnMapa(+b.dataset.i)));
}

function formatDuracion(h) {
  // se redondea el total en minutos primero, para no mostrar "14 h 60 min"
  const totalMin = Math.round(h * 60);
  const horas = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (horas === 0) return `${min} min`;
  return `${horas} h ${min} min`;
}

/* ---------------- mapa ---------------- */

function iniciarMapa() {
  map = L.map('routeMap', { zoomControl: true }).setView([4.6, -74.1], 6);
  Peajes.capaBase(map);
  fondoLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  tollLayerGroup = L.layerGroup().addTo(map);
  pintarFondo();
  // el mapa se mide al iniciar; si el layout termina de asentarse después
  // (fuentes, barra pegajosa), se recalcula para no dejar franjas sin tiles
  const fixSize = () => map.invalidateSize();
  requestAnimationFrame(() => requestAnimationFrame(fixSize));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fixSize);
  window.addEventListener('resize', fixSize);
  map.on('zoomend', despejarEtiquetas);
}

// Todos los peajes, tenues, como contexto: los de la ruta se pintan encima
function pintarFondo(excluir = new Set()) {
  fondoLayer.clearLayers();
  inventario.forEach(p => {
    if (excluir.has(p.id)) return;
    fondoLayer.addLayer(L.marker([p.lat, p.lon], { icon: Peajes.icono(p, { escala: .6 }), opacity: excluir.size ? .35 : .75, title: tc(p.nombre_display) })
      .bindPopup(() => popupHtml(p), { maxWidth: 260 }));
  });
}

function pintarLeyenda() {
  document.getElementById('leyenda').innerHTML = [['invias', 'INVIAS'], ['conc', 'Concesión'], ['def', 'Por definir']]
    .map(([t, n]) => `<span>${Peajes.talanquera(t, false, .8).svg}${n}</span>`).join('');
}

function renderMapa(ruta, matches, encuadrar = true) {
  routeLayer.clearLayers();
  tollLayerGroup.clearLayers();
  pintarFondo(new Set(matches.map(m => m.peaje.id)));

  // la vía: trazo oscuro con la línea amarilla discontinua encima
  const asfalto = getComputedStyle(document.documentElement).getPropertyValue('--asfalto').trim() || '#0d2a1c';
  const borde = getComputedStyle(document.documentElement).getPropertyValue('--ruta-borde').trim() || '#ffffff';
  const line = L.polyline(ruta.latlon, { color: asfalto, weight: 7, opacity: .95 });
  // borde claro debajo, para que la ruta se separe de las vías del mapa base
  routeLayer.addLayer(L.polyline(ruta.latlon, { color: borde, weight: 11, opacity: .9 }));
  routeLayer.addLayer(line);
  routeLayer.addLayer(L.polyline(ruta.latlon, { color: '#f6e016', weight: 2, dashArray: '8 8' }));
  routeLayer.addLayer(L.marker(ruta.latlon[0], { icon: extremoIcon(selOrigen.n), keyboard: false }));
  routeLayer.addLayer(L.marker(ruta.latlon[ruta.latlon.length - 1], { icon: extremoIcon(selDestino.n), keyboard: false }));

  tollMarkers = matches.map((m, i) => {
    const marker = L.marker([m.peaje.lat, m.peaje.lon], { icon: Peajes.icono(m.peaje, { on: true, precio: true, nro: i + 1 }), zIndexOffset: 1000, title: `${i + 1}. ${tc(m.peaje.nombre_display)}` });
    marker.bindPopup(() => popupHtml(m.peaje, m.along), { maxWidth: 260 });
    marker.on('click', () => marcarActivo(i));
    tollLayerGroup.addLayer(marker);
    return marker;
  });

  // encuadre un nivel más abierto que el justo, para ver la ruta con su entorno
  if (encuadrar) setTimeout(() => {
    map.invalidateSize();
    const caja = line.getBounds();
    map.setView(caja.getCenter(), map.getBoundsZoom(caja, false, L.point(80, 80)) - 1);
    despejarEtiquetas();
  }, 50);
  else setTimeout(despejarEtiquetas, 50);
}

/* En el mapa nada se monta: primero los números (que se esconden si chocan con
   otro número o con el nombre de una ciudad), luego las tarifas (que además
   evitan las talanqueras). Al acercar el mapa van apareciendo; el peaje
   elegido siempre muestra las dos cosas. Los peajes de fondo (gris) se
   esconden con el mapa lejos, cuando solo serían ruido alrededor de la ruta. */
function despejarEtiquetas() {
  if (!map) return;
  if (tollMarkers.length) {
    const lejos = map.getZoom() < 9;
    if (lejos && map.hasLayer(fondoLayer)) map.removeLayer(fondoLayer);
    if (!lejos && !map.hasLayer(fondoLayer)) map.addLayer(fondoLayer);
  }
  const rect = e => e.getBoundingClientRect();
  const choca = (r, lista) => lista.some(q => r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top);
  const ciudades = [...document.querySelectorAll('#routeMap .mk-extremo .mk-precio')].map(rect);
  const orden = tollMarkers.map((m, i) => i).sort((a, b) => (b === peajeActivo) - (a === peajeActivo));
  const elDe = i => tollMarkers[i].getElement();
  const mostrar = (e, ok) => { e.style.visibility = ok ? '' : 'hidden'; };

  const numeros = [...ciudades];
  orden.forEach(i => {
    const e = elDe(i) && elDe(i).querySelector('.mk-nro');
    if (!e) return;
    const r = rect(e), ok = i === peajeActivo || !choca(r, numeros);
    mostrar(e, ok);
    if (ok) numeros.push(r);
  });
  const puestas = [...numeros];
  tollMarkers.forEach((m, i) => { const e = elDe(i); if (e) puestas.push(rect(e.querySelector('svg'))); });
  orden.forEach(i => {
    const e = elDe(i) && elDe(i).querySelector('.mk-precio');
    if (!e) return;
    const r = rect(e), ok = i === peajeActivo || !choca(r, puestas);
    mostrar(e, ok);
    if (ok) puestas.push(r);
  });
}

// Marca el peaje elegido en el tiquete y en el mapa (sin mover el mapa)
function marcarActivo(i) {
  peajeActivo = i;
  document.querySelectorAll('#tiquete button.fila').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
  tollMarkers.forEach((m, j) => { const e = m.getElement(); if (e) e.classList.toggle('activo', j === i); });
  despejarEtiquetas();
}

// Lleva el mapa al peaje elegido en el tiquete y abre su ficha
function irAPeajeEnMapa(i) {
  const marker = tollMarkers[i];
  if (!map || !marker) return;
  marcarActivo(i);
  // el peaje queda en el centro del mapa; el popup se abre sin desplazarlo
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13), { animate: true });
  const popup = marker.getPopup();
  popup.options.autoPan = false;
  marker.openPopup();
  popup.options.autoPan = true;
  if (window.matchMedia('(max-width: 860px)').matches) document.getElementById('routeMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function popupHtml(p, along) {
  const cat = Peajes.cat;
  const tarifa = p.categorias ? p.categorias[cat] : null;
  return `<div class="popup">
    <b>${tc(p.nombre_display)}</b>
    <small>${p.operador || 'Operador por definir'}${p.departamento ? ' · ' + tc(p.departamento) : ''}</small>
    <div>Categoría ${cat}: <strong>${tarifa != null ? fmt(tarifa) : 'no aplica'}</strong></div>
    ${along != null ? `<small>km ${along.toFixed(0)} de la ruta</small>` : ''}
    ${p.cobra_en_sentido ? `<small>Cobra solo ${p.cobra_en_sentido.descripcion}</small>` : ''}
  </div>`;
}

// Origen y destino: un cuadro oscuro con el nombre de la ciudad, como en el tiquete
function extremoIcon(nombre) {
  return L.divIcon({
    className: 'mk mk-extremo',
    html: `<span style="display:block;width:16px;height:16px;background:#0d2a1c;border:3px solid #f6e016"></span><span class="mk-precio" style="left:20px;top:-4px">${nombre}</span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

init();
