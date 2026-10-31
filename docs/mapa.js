/* Peajes de Colombia — mapa de todos los peajes (Leaflet + OpenStreetMap) */

const { fmt, tc } = Peajes;
const CAT_EXTRA = ['VI', 'VII', 'VIII', 'IX'];   // categorías que solo algunos peajes publican
const ZOOM_PRECIOS = 11;                          // desde este zoom cada talanquera muestra su tarifa

let peajes = [];
let deptoBbox = {};
let map, cluster, markerById = {};
let activeType = 'all';
let activeDepto = 'all';
let selectedId = null;
let peajeInicial = null;
let focoAntesDeFicha = null;

const COUNTRY_VIEW = { center: [4.6, -74.1], zoom: 6 };

async function init() {
  const [peajesRes, bboxRes] = await Promise.all([
    fetch('data/peajes_clean.json'),
    fetch('data/departamentos_bbox.json'),
  ]);
  peajes = (await peajesRes.json()).filter(p => p.lat != null && p.lon != null);
  deptoBbox = await bboxRes.json();

  leerEstadoDeUrl();
  renderChips();
  renderDeptoSelect();
  pintarLeyenda();
  buildMap();
  applyFilters();

  document.getElementById('closeDetail').addEventListener('click', closeDetail);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('detailSheet').hidden) closeDetail();
  });
  document.getElementById('listToggle').addEventListener('click', () =>
    toggleList(!document.getElementById('contenido').classList.contains('show-list')));
  document.addEventListener('peajes:cat', () => {
    renderList();
    refrescarIconos();
    if (selectedId) showDetail(peajes.find(p => p.id === selectedId));
  });

  // La vista que pide la URL se aplica cuando el contenedor del mapa ya
  // tiene su tamaño final: antes, fitBounds calcula sobre un mapa de 0px
  // y termina en el zoom máximo.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    map.invalidateSize();
    if (activeDepto !== 'all') zoomToDepto(activeDepto);
    const pInicial = peajeInicial && peajes.find(p => String(p.id) === peajeInicial);
    if (pInicial) selectPeaje(pInicial.id, true);
  }));
}

/* ---- estado en la URL: ?depto=…&tipo=…&peaje=… (para compartir un filtro o un peaje) ---- */
function leerEstadoDeUrl() {
  const q = new URLSearchParams(location.search);
  const depto = q.get('depto');
  if (depto && peajes.some(p => p.departamento === depto)) activeDepto = depto;
  const tipo = q.get('tipo');
  if (['INVIAS', 'Concesión', 'Por definir'].includes(tipo)) activeType = tipo;
  peajeInicial = q.get('peaje');
}

function guardarEstadoEnUrl() {
  const q = new URLSearchParams();
  if (activeDepto !== 'all') q.set('depto', activeDepto);
  if (activeType !== 'all') q.set('tipo', activeType);
  if (selectedId != null) q.set('peaje', selectedId);
  const qs = q.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// En el teléfono la lista va bajo los filtros y se despliega con un botón
function toggleList(show) {
  document.getElementById('contenido').classList.toggle('show-list', show);
  const btn = document.getElementById('listToggle');
  btn.setAttribute('aria-expanded', String(show));
  btn.textContent = show ? 'Ocultar la lista' : 'Ver la lista de peajes';
}

/* ---- filtros ---- */
function renderDeptoSelect() {
  const sel = document.getElementById('deptoSelect');
  const names = [...new Set(peajes.map(p => p.departamento).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  sel.innerHTML = `<option value="all">Todos los departamentos</option>` +
    names.map(n => `<option value="${n}">${tc(n)}</option>`).join('');
  sel.value = activeDepto;

  sel.addEventListener('change', () => {
    activeDepto = sel.value;
    soltarSeleccion();
    applyFilters();
    zoomToDepto(activeDepto);
  });
}

function zoomToDepto(name) {
  if (name === 'all') {
    map.setView(COUNTRY_VIEW.center, COUNTRY_VIEW.zoom, { animate: true });
    return;
  }
  const bbox = deptoBbox[name];
  if (!bbox) return;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [30, 30], animate: true });
}

function filteredPeajes() {
  return peajes.filter(p =>
    (activeType === 'all' || p.operador_tipo === activeType) &&
    (activeDepto === 'all' || p.departamento === activeDepto));
}

/* Los dos filtros se combinan (departamento Y tipo de operador), así que el
   conteo de cada opción se calcula con el otro filtro ya aplicado: así
   "Atlántico (0)" con INVIAS activo avisa antes de elegir que no hay nada. */
function updateFilterCounts() {
  const sel = document.getElementById('deptoSelect');
  const porTipo = peajes.filter(p => activeType === 'all' || p.operador_tipo === activeType);
  [...sel.options].forEach(o => {
    if (o.value === 'all') return;
    o.textContent = `${tc(o.value)} (${porTipo.filter(p => p.departamento === o.value).length})`;
  });
  const porDepto = peajes.filter(p => activeDepto === 'all' || p.departamento === activeDepto);
  document.querySelectorAll('#chips button').forEach(b => {
    const k = b.dataset.key;
    b.querySelector('.chip-n').textContent = k === 'all' ? porDepto.length : porDepto.filter(p => p.operador_tipo === k).length;
  });
}

function renderChips() {
  const defs = [
    { key: 'all', label: 'Todos' },
    { key: 'INVIAS', label: 'INVIAS' },
    { key: 'Concesión', label: 'Concesión' },
  ];
  const el = document.getElementById('chips');
  el.innerHTML = defs.map(c =>
    `<button type="button" data-key="${c.key}" aria-pressed="${c.key === activeType}">${c.label} <span class="chip-n"></span></button>`).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setActiveType(b.dataset.key)));
}

function setActiveType(key) {
  activeType = key;
  soltarSeleccion();
  document.querySelectorAll('#chips button').forEach(ch => ch.setAttribute('aria-pressed', String(ch.dataset.key === key)));
  applyFilters();
}

function pintarLeyenda() {
  document.getElementById('leyenda').innerHTML = [['invias', 'INVIAS'], ['conc', 'Concesión'], ['def', 'Por definir']]
    .map(([t, n]) => `<span>${Peajes.talanquera(t, false, .8).svg}${n}</span>`).join('') +
    `<span style="color:var(--muted)">Acerca el mapa para ver las tarifas</span>`;
}

/* ---- mapa ---- */
function buildMap() {
  map = L.map('map', { zoomControl: true }).setView(COUNTRY_VIEW.center, COUNTRY_VIEW.zoom);
  Peajes.capaBase(map);

  cluster = L.markerClusterGroup({
    iconCreateFunction: c => L.divIcon({ html: `<span>${c.getChildCount()}</span>`, className: 'marker-cluster-peajes', iconSize: [38, 38] }),
    maxClusterRadius: 40,
    disableClusteringAtZoom: ZOOM_PRECIOS,
    showCoverageOnHover: false,
  });

  peajes.forEach(p => {
    const marker = L.marker([p.lat, p.lon], { icon: iconoDe(p), title: tc(p.nombre_display) });
    marker.on('click', () => selectPeaje(p.id, false));
    markerById[p.id] = marker;
  });
  map.addLayer(cluster);

  let conPrecios = false;
  map.on('zoomend', () => {
    const ahora = map.getZoom() >= ZOOM_PRECIOS;
    if (ahora !== conPrecios) { conPrecios = ahora; refrescarIconos(); }
  });

  // Leaflet mide el contenedor al inicializar; si el layout termina de
  // asentarse después (fuentes, barra), se recalcula para no dejar franjas
  const fixSize = () => map.invalidateSize();
  requestAnimationFrame(() => requestAnimationFrame(fixSize));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fixSize);
  window.addEventListener('resize', fixSize);
}

function iconoDe(p) {
  return Peajes.icono(p, { on: p.id === selectedId, precio: map && map.getZoom() >= ZOOM_PRECIOS });
}

function refrescarIconos() {
  peajes.forEach(p => markerById[p.id].setIcon(iconoDe(p)));
  if (selectedId && markerById[selectedId]) markerById[selectedId].setZIndexOffset(1000);
}

/* ---- lista ---- */
function renderList() {
  const el = document.getElementById('list');
  const subset = filteredPeajes();
  const cat = Peajes.cat;
  document.getElementById('sidebarCount').textContent = `${subset.length} de ${peajes.length} peajes · tarifa para categoría ${cat}`;
  if (!subset.length) {
    const tipo = { 'INVIAS': 'de INVIAS', 'Concesión': 'en concesión', 'Por definir': 'con operador por definir' }[activeType] || '';
    const donde = activeDepto !== 'all' ? ` en ${tc(activeDepto)}` : '';
    el.innerHTML = `<li class="list-empty"><p>No hay peajes ${tipo}${donde}.</p>
      <button type="button" id="clearType">Ver todos los tipos de operador</button></li>`;
    document.getElementById('clearType').addEventListener('click', () => setActiveType('all'));
    return;
  }
  el.innerHTML = subset.map(p => `
    <li><button type="button" class="lista-item${p.id === selectedId ? ' active' : ''}" data-id="${p.id}"${p.id === selectedId ? ' aria-current="true"' : ''}>
      ${Peajes.talanquera(Peajes.tipoClase(p), false, .8).svg}
      <span class="n">${tc(p.nombre_display)}<small>${tc(p.departamento) || 'Departamento sin definir'}</small></span>
      <span class="v">${p.categorias[cat] != null ? fmt(p.categorias[cat]) : 'sin tarifa'}</span>
    </button></li>`).join('');
  el.querySelectorAll('.lista-item').forEach(b => b.addEventListener('click', () => selectPeaje(b.dataset.id, true)));
}

function applyFilters() {
  updateFilterCounts();
  renderList();
  cluster.clearLayers();
  cluster.addLayers(filteredPeajes().map(p => markerById[p.id]));
  guardarEstadoEnUrl();
}

/* ---- ficha: el tiquete del peaje ---- */
function selectPeaje(id, panMap) {
  const anterior = selectedId;
  selectedId = id;
  const p = peajes.find(x => x.id === id);
  if (!p) return;
  renderList();
  guardarEstadoEnUrl();
  if (anterior && markerById[anterior]) markerById[anterior].setIcon(iconoDe(peajes.find(x => x.id === anterior))).setZIndexOffset(0);
  markerById[id].setIcon(iconoDe(p)).setZIndexOffset(1000);
  if (panMap) {
    // el marcador puede estar dentro de un grupo: se acerca lo necesario para mostrarlo
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), ZOOM_PRECIOS + 1), { animate: true });
  }
  showDetail(p);
}

function showDetail(p) {
  const cat = Peajes.cat;
  const fila = k => `<div class="fila${k === cat ? ' on' : ''}"><span>${k}${Peajes.CAT[k] ? ' · ' + Peajes.CAT[k] : ''}</span><span class="v">${fmt(p.categorias[k])}</span></div>`;
  const filas = [...Peajes.CATS, ...CAT_EXTRA].filter(k => p.categorias[k] != null).map(fila).join('');
  document.getElementById('detailContent').innerHTML = `
    <header><h2 id="detailName">${tc(p.nombre_display)}</h2>${tc(p.departamento)} · ${p.operador || 'Operador por definir'}</header>
    ${filas || '<p class="pie">Sin tarifas publicadas</p>'}
    ${p.categorias[cat] == null && filas ? `<p class="aviso">Este peaje no publica tarifa para la categoría ${cat}.</p>` : ''}
    ${p.cobra_en_sentido ? `<p class="aviso">Cobra solo en sentido <b>${p.cobra_en_sentido.descripcion}</b>. En el sentido contrario se paga en la otra estación del túnel.</p>` : ''}
    <dl>
      <div><dt>Ubicación</dt><dd>${p.ubicacion || '—'}</dd></div>
      <div><dt>Sector</dt><dd>${p.sector || '—'}</dd></div>
      <div><dt>Teléfono del peaje</dt><dd>${p.telefono_peaje || '—'}</dd></div>
      <div><dt>Teléfono de grúa</dt><dd>${p.telefono_grua || '—'}</dd></div>
      <div><dt>Territorial INVIAS</dt><dd>${p.territorial || '—'}</dd></div>
      <div><dt>Código de peaje</dt><dd>${p.codigo_peaje || '—'}</dd></div>
    </dl>
    ${p.url_ficha ? `<a class="enlace" href="${p.url_ficha}" target="_blank" rel="noopener">Ver ficha oficial de INVIAS ↗</a>` : ''}
    <p class="pie">Tarifas vigentes 2026</p>`;
  const sheet = document.getElementById('detailSheet');
  // se recuerda de dónde venía el foco (un ítem de la lista, un marcador) para devolverlo al cerrar
  if (sheet.hidden) focoAntesDeFicha = document.activeElement;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  document.getElementById('closeDetail').focus({ preventScroll: true });
}

// Al cambiar de filtro la ficha abierta deja de tener sentido: se cierra y el
// peaje deja de estar seleccionado (sin mover el foco, que sigue en el filtro)
function soltarSeleccion() {
  if (!selectedId) return;
  const anterior = selectedId;
  selectedId = null;
  document.getElementById('detailSheet').hidden = true;
  if (markerById[anterior]) markerById[anterior].setIcon(iconoDe(peajes.find(x => x.id === anterior))).setZIndexOffset(0);
}

function closeDetail() {
  document.getElementById('detailSheet').hidden = true;
  const anterior = selectedId;
  selectedId = null;
  if (anterior && markerById[anterior]) markerById[anterior].setIcon(iconoDe(peajes.find(x => x.id === anterior))).setZIndexOffset(0);
  renderList();
  guardarEstadoEnUrl();
  // renderList() recreó los ítems, así que se busca el del peaje por id;
  // si no está en la lista (filtrada), se vuelve a lo que tenía el foco antes
  const previo = focoAntesDeFicha && document.contains(focoAntesDeFicha) && focoAntesDeFicha !== document.body ? focoAntesDeFicha : null;
  const destino = document.querySelector(`.lista-item[data-id="${anterior}"]`) || previo;
  if (destino) destino.focus({ preventScroll: true });
}

init();
