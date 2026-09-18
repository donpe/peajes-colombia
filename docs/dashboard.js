/* Dashboard de análisis — Peajes de Colombia */

const money = n => n == null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
const OP_COLOR = { 'INVIAS': '#2f7d52', 'Concesión': '#d1495b', 'Por definir': '#8991b3' };

const CAT_LABEL = {
  I: 'I — Auto', II: 'II — Bus/2 ejes', III: 'III — Cam. 3 ejes',
  IV: 'IV — Cam. 4 ejes', V: 'V — Cam. 5+ ejes',
};

function css(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

async function init() {
  const res = await fetch('data/peajes_clean.json');
  const peajes = await res.json();
  const conTarifa = peajes.filter(p => p.tarifa_cat1 != null);
  const conCoords = peajes.filter(p => p.lat != null && p.lon != null);

  renderKpis(peajes, conTarifa);
  renderHistogram(conTarifa);
  renderOperatorSplit(peajes, conTarifa);
  renderRankings(conTarifa);
  renderDeptoBars(peajes);
  renderOperatorBars(peajes);
  renderCategoryBars(peajes);
  renderDistanceAnalysis(conCoords);
}

// Distancia geodésica (línea recta) entre dos puntos, en km — fórmula de Haversine.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderDistanceAnalysis(peajes) {
  // Vecino más cercano de cada peaje (y su distancia), por fuerza bruta —
  // 180 puntos son ~16.000 pares, trivial para el navegador.
  const nearest = peajes.map(p => {
    let best = null, bestDist = Infinity;
    peajes.forEach(q => {
      if (q === p) return;
      const d = haversineKm(p.lat, p.lon, q.lat, q.lon);
      if (d < bestDist) { bestDist = d; best = q; }
    });
    return { p, neighbor: best, dist: bestDist };
  });

  const distances = nearest.map(n => n.dist);
  const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
  const closest = [...nearest].sort((a, b) => a.dist - b.dist)[0];
  const farthest = [...nearest].sort((a, b) => b.dist - a.dist)[0];

  document.getElementById('distKpiRow').innerHTML = [
    { v: closest.dist.toFixed(2) + ' km', l: `Par más cercano — ${closest.p.nombre} / ${closest.neighbor.nombre}` },
    { v: farthest.dist.toFixed(1) + ' km', l: `Peaje más aislado — ${farthest.p.nombre}` },
    { v: avgDist.toFixed(1) + ' km', l: 'Distancia promedio al vecino más cercano' },
  ].map(k => `<div class="kpi"><b>${k.v}</b><span>${k.l}</span></div>`).join('');

  // pares únicos más cercanos (evitar mostrar el mismo par dos veces, una por cada lado)
  const seen = new Set();
  const pairs = [];
  [...nearest].sort((a, b) => a.dist - b.dist).forEach(n => {
    const key = [n.p.id, n.neighbor.id].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push(n);
  });

  document.getElementById('closestPairs').innerHTML = pairs.slice(0, 10).map((n, i) => `
    <div class="rank-row">
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-name">${n.p.nombre_display} ↔ ${n.neighbor.nombre_display}
        <div class="rank-sub">${n.p.departamento ? toTitle(n.p.departamento) : 'Departamento sin definir'}</div>
      </span>
      <span class="rank-val">${n.dist.toFixed(2)} km</span>
    </div>`).join('');

  const isolated = [...nearest].sort((a, b) => b.dist - a.dist).slice(0, 10);
  document.getElementById('mostIsolated').innerHTML = isolated.map((n, i) => `
    <div class="rank-row">
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-name">${n.p.nombre_display}
        <div class="rank-sub">Más cercano: ${n.neighbor.nombre_display}</div>
      </span>
      <span class="rank-val">${n.dist.toFixed(1)} km</span>
    </div>`).join('');

  renderDistanceHistogram(distances);
}

function renderDistanceHistogram(distances) {
  const step = 10;
  const max = Math.ceil(Math.max(...distances) / step) * step;
  const buckets = [];
  for (let b = 0; b < max; b += step) buckets.push({ from: b, to: b + step, n: 0 });
  distances.forEach(d => {
    const idx = Math.min(Math.floor(d / step), buckets.length - 1);
    buckets[idx].n++;
  });

  new Chart(document.getElementById('distHistChart'), {
    type: 'bar',
    data: {
      labels: buckets.map(b => `${b.from}`),
      datasets: [{
        data: buckets.map(b => b.n),
        backgroundColor: css('--public'),
        borderRadius: 4,
        maxBarThickness: 28,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (items) => {
          const b = buckets[items[0].dataIndex];
          return `${b.from} – ${b.to} km`;
        } } },
      },
      scales: {
        x: { title: { display: true, text: 'km al vecino más cercano', color: css('--ink-soft'), font: { family: 'Outfit', size: 11 } },
             grid: { display: false }, ticks: { color: css('--ink-soft'), font: { family: 'Roboto Mono', size: 10 } } },
        y: { beginAtZero: true, ticks: { precision: 0, color: css('--ink-soft') }, grid: { color: css('--line-soft') } },
      },
    },
  });
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function renderKpis(peajes, conTarifa) {
  const t1 = conTarifa.map(p => p.tarifa_cat1);
  const avg = Math.round(t1.reduce((a, b) => a + b, 0) / t1.length);
  const med = Math.round(median(t1));
  const maxP = conTarifa.reduce((a, b) => (b.tarifa_cat1 > a.tarifa_cat1 ? b : a));
  const nDeptos = new Set(peajes.map(p => p.departamento).filter(Boolean)).size;

  const kpis = [
    { v: peajes.length, l: 'Peajes en el inventario' },
    { v: '$' + money(avg), l: 'Tarifa Cat. I promedio' },
    { v: '$' + money(med), l: 'Tarifa Cat. I mediana' },
    { v: '$' + money(maxP.tarifa_cat1), l: `Más caro — ${maxP.nombre}` },
    { v: nDeptos, l: 'Departamentos con peajes' },
  ];
  document.getElementById('kpiRow').innerHTML = kpis.map(k =>
    `<div class="kpi"><b>${k.v}</b><span>${k.l}</span></div>`).join('');
}

function renderHistogram(conTarifa) {
  const vals = conTarifa.map(p => p.tarifa_cat1);
  const step = 3000;
  const max = Math.ceil(Math.max(...vals) / step) * step;
  const buckets = [];
  for (let b = 0; b < max; b += step) buckets.push({ from: b, to: b + step, n: 0 });
  vals.forEach(v => {
    const idx = Math.min(Math.floor(v / step), buckets.length - 1);
    buckets[idx].n++;
  });

  new Chart(document.getElementById('histChart'), {
    type: 'bar',
    data: {
      labels: buckets.map(b => `$${Math.round(b.from / 1000)}k`),
      datasets: [{
        data: buckets.map(b => b.n),
        backgroundColor: css('--accent'),
        borderRadius: 4,
        maxBarThickness: 34,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { title: (items) => {
          const b = buckets[items[0].dataIndex];
          return `$${money(b.from)} – $${money(b.to)}`;
        } },
      } },
      scales: {
        x: { grid: { display: false }, ticks: { color: css('--ink-soft'), font: { family: 'Roboto Mono', size: 10 } } },
        y: { beginAtZero: true, ticks: { precision: 0, color: css('--ink-soft') }, grid: { color: css('--line-soft') } },
      },
    },
  });
}

function renderOperatorSplit(peajes, conTarifa) {
  const nInvias = peajes.filter(p => p.operador_tipo === 'INVIAS').length;
  const nConc = peajes.filter(p => p.operador_tipo === 'Concesión').length;
  const nDef = peajes.length - nInvias - nConc;

  const avgFor = (tipo) => {
    const vals = conTarifa.filter(p => p.operador_tipo === tipo).map(p => p.tarifa_cat1);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };

  new Chart(document.getElementById('opChart'), {
    type: 'doughnut',
    data: {
      labels: [`INVIAS (${nInvias})`, `Concesión (${nConc})`, `Por definir (${nDef})`],
      datasets: [{
        data: [nInvias, nConc, nDef],
        backgroundColor: [OP_COLOR.INVIAS, OP_COLOR['Concesión'], OP_COLOR['Por definir']],
        borderColor: css('--surface'),
        borderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: css('--ink-soft'), font: { family: 'Outfit', size: 12 }, padding: 14 } },
        tooltip: {
          callbacks: {
            afterLabel: (item) => {
              const tipo = item.label.startsWith('INVIAS') ? 'INVIAS' : item.label.startsWith('Concesión') ? 'Concesión' : null;
              return tipo ? `Tarifa Cat. I prom: $${money(avgFor(tipo))}` : '';
            },
          },
        },
      },
    },
  });
}

function renderRankings(conTarifa) {
  const sorted = [...conTarifa].sort((a, b) => b.tarifa_cat1 - a.tarifa_cat1);
  const top = sorted.slice(0, 10);
  const bottom = sorted.slice(-10).reverse();

  const rowHtml = (p, i) => `
    <div class="rank-row">
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-name">${p.nombre_display}<div class="rank-sub">${p.operador || 'Operador no definido'}</div></span>
      <span class="rank-val">$${money(p.tarifa_cat1)}</span>
    </div>`;

  document.getElementById('topExpensive').innerHTML = top.map(rowHtml).join('');
  document.getElementById('topCheap').innerHTML = bottom.map(rowHtml).join('');
}

function barRows(container, items, colorVar) {
  const max = Math.max(...items.map(i => i.value));
  const color = css(colorVar);
  container.innerHTML = items.map(i => `
    <div class="bar-row">
      <span class="bar-label" title="${i.label}">${i.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(i.value / max * 100).toFixed(1)}%;background:${color}"></div></div>
      <span class="bar-val">${i.value}</span>
    </div>`).join('');
}

function toTitle(s) {
  return s.toLowerCase().replace(/(^|\s)([a-záéíóúñ])/g, (m, sep, c) => sep + c.toUpperCase());
}

function renderDeptoBars(peajes) {
  const counts = {};
  peajes.forEach(p => { if (p.departamento) counts[p.departamento] = (counts[p.departamento] || 0) + 1; });
  const items = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ label: toTitle(name), value: n }));
  barRows(document.getElementById('deptoBars'), items, '--accent');
}

function renderOperatorBars(peajes) {
  const counts = {};
  peajes.forEach(p => {
    const key = p.operador || (p.operador_tipo === 'Por definir' ? 'Sin definir' : p.operador_tipo);
    counts[key] = (counts[key] || 0) + 1;
  });
  const items = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, n]) => ({ label: name, value: n }));
  barRows(document.getElementById('operatorBars'), items, '--accent');
}

function renderCategoryBars(peajes) {
  const cats = ['I', 'II', 'III', 'IV', 'V'];
  const items = cats.map(c => {
    const vals = peajes.map(p => p.categorias && p.categorias[c]).filter(v => v != null);
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    return { label: CAT_LABEL[c], value: avg };
  });
  const max = Math.max(...items.map(i => i.value));
  const color = css('--accent');
  document.getElementById('categoryBars').innerHTML = items.map(i => `
    <div class="bar-row">
      <span class="bar-label" title="${i.label}">${i.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(i.value / max * 100).toFixed(1)}%;background:${color}"></div></div>
      <span class="bar-val" style="width:64px">$${money(i.value)}</span>
    </div>`).join('');
}

init();
