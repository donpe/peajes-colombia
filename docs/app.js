/* Peajes de Colombia — mapa interactivo (Leaflet + OpenStreetMap) */

const OP_COLOR = { 'INVIAS': '#2f7d52', 'Concesión': '#d1495b', 'Por definir': '#8991b3' };
const OP_CLASS = { 'INVIAS': 'invias', 'Concesión': 'concesion', 'Por definir': 'pordefinir' };
const CAT_ORDER = ['I','II','III','IV','V','VI','VII','VIII','IX'];
const CAT_LABEL = {
  I:'Categoría I — Automóvil', II:'Categoría II — Bus / 2 ejes', III:'Categoría III — Camión 3 ejes',
  IV:'Categoría IV — Camión 4 ejes', V:'Categoría V — Camión 5+ ejes',
  VI:'Categoría VI', VII:'Categoría VII', VIII:'Categoría VIII', IX:'Categoría IX',
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

  renderStats();
  renderChips();
  renderDeptoSelect();
  buildMap();
  renderList();

  document.getElementById('closeDetail').addEventListener('click', closeDetail);
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
  const label = activeDepto === 'all' ? 'Peajes' : 'Peajes filtrados';
  document.getElementById('stats').innerHTML = `
    <div class="stat"><b>${subset.length}</b><span>${label}</span></div>
    <div class="stat"><b>${nInvias}</b><span>INVIAS</span></div>
    <div class="stat"><b>${nConc}</b><span>Concesión</span></div>
    <div class="stat"><b>${avg != null ? '$' + money(avg) : '—'}</b><span>Cat. I prom.</span></div>
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
    b.setAttribute('aria-pressed', c.key === 'all' ? 'true' : 'false');
    b.innerHTML = (c.color ? `<span class="dot" style="background:${c.color}"></span>` : '') + c.label;
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
      <text x="13" y="17.5" text-anchor="middle" font-family="'Roboto Mono', monospace"
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
  return `<div style="font-family:'Outfit',sans-serif;font-size:13px;min-width:180px">
    <div style="font-weight:700;font-family:'Outfit',sans-serif;font-size:15px">${p.nombre_display}</div>
    <div style="color:#666;margin:2px 0 6px">${p.operador || 'Operador no definido'}</div>
    <div style="font-family:'Roboto Mono',monospace;font-weight:600">Cat. I: $${money(p.tarifa_cat1)}</div>
  </div>`;
}

function renderList() {
  const el = document.getElementById('list');
  el.innerHTML = '';
  const subset = filteredPeajes();
  subset.forEach(p => {
    const item = document.createElement('div');
    item.className = 'list-item' + (p.id === selectedId ? ' active' : '');
    item.innerHTML = `
      <div class="li-top">
        <span class="li-dot" style="background:${OP_COLOR[p.operador_tipo] || OP_COLOR['Por definir']}"></span>
        <span class="li-name">${p.nombre_display}</span>
      </div>
      <span class="li-sub">${p.ubicacion || ''}</span>
      <span class="li-price">Cat. I: $${money(p.tarifa_cat1)}</span>
    `;
    item.addEventListener('click', () => selectPeaje(p.id, true));
    el.appendChild(item);
  });
  document.getElementById('sidebarCount').textContent = `${subset.length} de ${peajes.length} peajes`;
}

function applyFilters() {
  renderStats();
  renderList();
  cluster.clearLayers();
  filteredPeajes().forEach(p => cluster.addLayer(markerById[p.id]));
}

function selectPeaje(id, panMap) {
  selectedId = id;
  const p = peajes.find(x => x.id === id);
  if (!p) return;
  renderList();
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
    <div class="d-name">${p.nombre_display}</div>
    <div class="d-route">${p.ubicacion || ''}${p.sector ? ' · Sector: ' + p.sector : ''}</div>
    <div class="d-op">Operador: <b>${p.operador || 'No definido'}</b></div>
    <table class="tariff-table">
      <thead><tr><th>Tarifa por categoría</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2" style="color:var(--ink-faint)">Sin tarifas registradas</td></tr>'}</tbody>
    </table>
    <div class="meta-grid">
      <div><span>Territorial INVIAS</span><b>${p.territorial || '—'}</b></div>
      <div><span>Código de peaje</span><b>${p.codigo_peaje || '—'}</b></div>
      <div><span>Tel. peaje</span><b>${p.telefono_peaje || '—'}</b></div>
      <div><span>Tel. grúa</span><b>${p.telefono_grua || '—'}</b></div>
    </div>
    ${p.url_ficha ? `<a class="ficha-link" href="${p.url_ficha}" target="_blank" rel="noopener">Ver ficha oficial INVIAS ↗</a>` : ''}
  `;
  document.getElementById('detailSheet').hidden = false;
}

function closeDetail() {
  document.getElementById('detailSheet').hidden = true;
  selectedId = null;
  renderList();
}

init();
