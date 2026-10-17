/* Peajes de Colombia — mapa interactivo (Leaflet + OpenStreetMap) */

const OP_COLOR = { 'INVIAS': '#2f7d52', 'Concesión': '#d1495b', 'Por definir': '#8991b3' };
const OP_CLASS = { 'INVIAS': 'invias', 'Concesión': 'concesion', 'Por definir': 'pordefinir' };
const CAT_ORDER = ['I','II','III','IV','V','VI','VII','VIII','IX'];
const CAT_LABEL = {
  I:'I · Automóvil', II:'II · Bus o 2 ejes', III:'III · Camión 3 ejes',
  IV:'IV · Camión 4 ejes', V:'V · Camión 5+ ejes',
  VI:'VI', VII:'VII', VIII:'VIII', IX:'IX',
};
const money = n => n == null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

let peajes = [];
let deptoBbox = {};
let map, cluster, markerById = {};
let activeType = 'all';
let activeDepto = 'all';
let selectedId = null;

const COUNTRY_VIEW = { center: [4.6, -74.1], zoom: 6 };

async function init() {
  const [peajesRes, bboxRes] = await Promise.all([
    fetch('data/peajes_clean.json'),
    fetch('data/departamentos_bbox.json'),
  ]);
  const all = await peajesRes.json();
  deptoBbox = await bboxRes.json();
  peajes = all.filter(p => p.lat != null && p.lon != null);

  leerEstadoDeUrl();
  renderStats();
  renderChips();
  renderDeptoSelect();
  buildMap();
  applyFilters();

  document.getElementById('closeDetail').addEventListener('click', closeDetail);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('detailSheet').hidden) closeDetail();
    else if (document.body.classList.contains('show-list')) toggleList(false);
  });
  document.getElementById('listToggle').addEventListener('click', () =>
    toggleList(!document.body.classList.contains('show-list')));

  // La vista que pide la URL se aplica cuando el contenedor del mapa ya
  // tiene su tamaño final (ver fixSize en buildMap): antes, fitBounds
  // calcula sobre un mapa de 0px y termina en el zoom máximo.
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
  if (tipo && OP_COLOR[tipo]) activeType = tipo;
  peajeInicial = q.get('peaje');
}

let peajeInicial = null;

function guardarEstadoEnUrl() {
  const q = new URLSearchParams();
  if (activeDepto !== 'all') q.set('depto', activeDepto);
  if (activeType !== 'all') q.set('tipo', activeType);
  if (selectedId != null) q.set('peaje', selectedId);
  const qs = q.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// En móvil la lista no cabe junto al mapa: se abre encima con un botón.
function toggleList(show) {
  document.body.classList.toggle('show-list', show);
  const btn = document.getElementById('listToggle');
  btn.setAttribute('aria-expanded', String(show));
  btn.textContent = show ? 'Ver mapa' : 'Ver lista';
  if (!show) requestAnimationFrame(() => map.invalidateSize());
}

function renderDeptoSelect() {
  const counts = {};
  peajes.forEach(p => {
    if (p.departamento) counts[p.departamento] = (counts[p.departamento] || 0) + 1;
  });
  const names = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'es'));

  const sel = document.getElementById('deptoSelect');
  sel.innerHTML = `<option value="all">Todos los departamentos</option>` +
    names.map(n => `<option value="${n}">${titleCase(n)} (${counts[n]})</option>`).join('');
  sel.value = activeDepto;

  sel.addEventListener('change', () => {
    activeDepto = sel.value;
    applyFilters();
    zoomToDepto(activeDepto);
  });
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|\s|\(|\.)([a-záéíóúñ])/g, (m, sep, c) => sep + c.toUpperCase());
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
  return peajes.filter(p => {
    const typeOk = activeType === 'all' || p.operador_tipo === activeType;
    const deptoOk = activeDepto === 'all' || p.departamento === activeDepto;
    return typeOk && deptoOk;
  });
}

function renderStats() {
  const subset = filteredPeajes();
  const nInvias = subset.filter(p => p.operador_tipo === 'INVIAS').length;
  const nConc = subset.filter(p => p.operador_tipo === 'Concesión').length;
  const t1 = subset.map(p => p.tarifa_cat1).filter(v => v != null);
  const avg = t1.length ? Math.round(t1.reduce((a, b) => a + b, 0) / t1.length) : null;
  document.getElementById('stats').innerHTML = `
    <span class="stat"><b>${subset.length}</b><span>peajes</span></span>
    <span class="stat"><b>${nInvias}</b><span>INVIAS</span></span>
    <span class="stat"><b>${nConc}</b><span>en concesión</span></span>
    <span class="stat"><b>${avg != null ? '$' + money(avg) : '—'}</b><span>promedio automóvil</span></span>
  `;
}

function renderChips() {
  const defs = [
    { key: 'all', label: 'Todos', color: null },
    { key: 'INVIAS', label: 'INVIAS', color: OP_COLOR.INVIAS },
    { key: 'Concesión', label: 'Concesión', color: OP_COLOR['Concesión'] },
    { key: 'Por definir', label: 'Por definir', color: OP_COLOR['Por definir'] },
  ];
  const el = document.getElementById('chips');
  defs.forEach(c => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.setAttribute('aria-pressed', c.key === activeType ? 'true' : 'false');
    b.innerHTML = (c.color ? `<span class="dot" style="background:${c.color}" aria-hidden="true"></span>` : '') + c.label;
    b.addEventListener('click', () => {
      activeType = c.key;
      [...el.children].forEach(ch => ch.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      applyFilters();
    });
    el.appendChild(b);
  });
}

function buildMap() {
  map = L.map('map', { zoomControl: true }).setView([4.6, -74.1], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(map);

  cluster = L.markerClusterGroup({
    iconCreateFunction: cluster => L.divIcon({
      html: `<span>${cluster.getChildCount()}</span>`,
      className: 'marker-cluster-peajes',
      iconSize: [36, 36],
    }),
    maxClusterRadius: 45,
    showCoverageOnHover: false,
  });

  peajes.forEach(p => {
    const color = OP_COLOR[p.operador_tipo] || OP_COLOR['Por definir'];
    const marker = L.marker([p.lat, p.lon], { icon: tollPinIcon(color) });
    marker.bindPopup(popupHtml(p), { maxWidth: 260 });
    marker.on('click', () => selectPeaje(p.id, false));
    cluster.addLayer(marker);
    markerById[p.id] = marker;
  });

  map.addLayer(cluster);

  // Leaflet mide el contenedor al inicializar; si el layout (flexbox, fuentes
  // cargando) termina de asentarse después, el grid de tiles queda desfasado
  // y se ve una franja gris. Forzamos un recálculo cuando el layout se estabiliza.
  const fixSize = () => map.invalidateSize();
  requestAnimationFrame(() => requestAnimationFrame(fixSize));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fixSize);
  window.addEventListener('resize', fixSize);
}

function tollPinIcon(color) {
  const svg = `
    <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0.5C6.1 0.5 0.5 6.1 0.5 13c0 9.2 12.5 20 12.5 20s12.5-10.8 12.5-20C25.5 6.1 19.9 0.5 13 0.5z"
            fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="13" cy="13" r="7" fill="#fff"/>
      <text x="13" y="17.5" text-anchor="middle" font-family="Outfit, sans-serif"
            font-weight="700" font-size="11" fill="${color}">$</text>
    </svg>`;
  return L.divIcon({
    className: 'peaje-pin',
    html: svg,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });
}

function popupHtml(p) {
  return `<div class="popup">
    <div class="popup-name">${p.nombre_display}</div>
    <div class="popup-op">${p.operador || 'Operador no definido'}</div>
    <div class="popup-price">Automóvil: $${money(p.tarifa_cat1)}</div>
  </div>`;
}

function renderList() {
  const el = document.getElementById('list');
  el.innerHTML = '';
  const subset = filteredPeajes();
  subset.forEach(p => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'list-item' + (p.id === selectedId ? ' active' : '');
    item.dataset.id = p.id;
    if (p.id === selectedId) item.setAttribute('aria-current', 'true');
    item.innerHTML = `
      <span class="li-top">
        <span class="li-dot" style="background:${OP_COLOR[p.operador_tipo] || OP_COLOR['Por definir']}" aria-hidden="true"></span>
        <span class="li-name">${p.nombre_display}</span>
      </span>
      ${p.ubicacion ? `<span class="li-sub">${p.ubicacion}</span>` : ''}
      <span class="li-price">Automóvil: $${money(p.tarifa_cat1)}</span>
    `;
    item.addEventListener('click', () => {
      if (document.body.classList.contains('show-list')) toggleList(false);
      selectPeaje(p.id, true);
    });
    el.appendChild(item);
  });
  document.getElementById('sidebarCount').textContent = `${subset.length} de ${peajes.length} peajes`;
}

function applyFilters() {
  renderStats();
  renderList();
  cluster.clearLayers();
  filteredPeajes().forEach(p => cluster.addLayer(markerById[p.id]));
  guardarEstadoEnUrl();
}

function selectPeaje(id, panMap) {
  selectedId = id;
  const p = peajes.find(x => x.id === id);
  if (!p) return;
  renderList();
  guardarEstadoEnUrl();
  if (panMap) {
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 12), { animate: true });
    markerById[id].openPopup();
  }
  showDetail(p);
}

function showDetail(p) {
  const rows = CAT_ORDER.filter(k => p.categorias[k] != null)
    .map(k => `<tr><td>${CAT_LABEL[k] || ('Categoría ' + k)}</td><td>$${money(p.categorias[k])}</td></tr>`).join('');
  document.getElementById('detailContent').innerHTML = `
    <span class="d-badge ${OP_CLASS[p.operador_tipo] || 'pordefinir'}">${p.operador_tipo}</span>
    <h2 class="d-name" id="detailName">${p.nombre_display}</h2>
    <div class="d-route">${p.ubicacion || ''}${p.sector ? ' · Sector: ' + p.sector : ''}</div>
    <div class="d-op">Operador: <b>${p.operador || 'No definido'}</b></div>
    <table class="tariff-table">
      <thead><tr><th>Tarifa por categoría</th><th>Valor</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2" style="color:var(--ink-faint)">Sin tarifas registradas</td></tr>'}</tbody>
    </table>
    <dl class="meta-grid">
      <div><dt>Territorial INVIAS</dt><dd>${p.territorial || '—'}</dd></div>
      <div><dt>Código de peaje</dt><dd>${p.codigo_peaje || '—'}</dd></div>
      <div><dt>Teléfono del peaje</dt><dd>${p.telefono_peaje || '—'}</dd></div>
      <div><dt>Teléfono de grúa</dt><dd>${p.telefono_grua || '—'}</dd></div>
    </dl>
    ${p.url_ficha ? `<a class="ficha-link" href="${p.url_ficha}" target="_blank" rel="noopener">Ver ficha oficial de INVIAS ↗</a>` : ''}
  `;
  const sheet = document.getElementById('detailSheet');
  // se recuerda de dónde venía el foco (un ítem de la lista, un marcador) para devolverlo al cerrar
  if (sheet.hidden) focoAntesDeFicha = document.activeElement;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  document.getElementById('closeDetail').focus({ preventScroll: true });
}

let focoAntesDeFicha = null;

function closeDetail() {
  document.getElementById('detailSheet').hidden = true;
  const anterior = selectedId;
  selectedId = null;
  renderList();
  guardarEstadoEnUrl();
  // renderList() recreó los ítems, así que se busca el ítem del peaje por id;
  // si no está en la lista (filtrado), se vuelve a lo que tenía el foco antes
  const previo = focoAntesDeFicha && document.contains(focoAntesDeFicha) && focoAntesDeFicha !== document.body
    ? focoAntesDeFicha : null;
  const destino = document.querySelector(`.list-item[data-id="${anterior}"]`) || previo;
  if (destino) destino.focus({ preventScroll: true });
}

init();
