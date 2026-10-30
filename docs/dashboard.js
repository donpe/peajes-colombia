/* Datos — Peajes de Colombia
   Seis preguntas sobre el inventario, todas recalculadas para el vehículo
   elegido en "Tu vehículo". Gráficos en HTML/SVG, sin librerías: columnas
   y barras de un solo tono (la tinta), con el amarillo solo para resaltar. */

const { fmt, tc } = Peajes;
let peajes = [];

const promedio = a => a.reduce((s, x) => s + x, 0) / a.length;
const mediana = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmtMil = n => '$' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(n / 1000) + ' mil';
const veces = n => '×' + n.toLocaleString('es-CO', { maximumFractionDigits: 1 });

// Distancia geodésica (línea recta) entre dos peajes, en km — fórmula de Haversine
function km(a, b) {
  const R = 6371, r = x => x * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ---- tooltip compartido (mouse y teclado) ---- */
const tip = document.getElementById('tip');
function mostrarTip(x, y, html) {
  tip.innerHTML = html; tip.hidden = false;
  tip.style.left = Math.min(x + 14, innerWidth - 290) + 'px';
  tip.style.top = (y + 14) + 'px';
}
const ocultarTip = () => { tip.hidden = true; };

async function init() {
  const res = await fetch('data/peajes_clean.json');
  peajes = await res.json();
  pintar();
  pintarCercanos();
  document.addEventListener('peajes:cat', pintar);
}

function pintar() {
  const cat = Peajes.cat;
  const con = peajes.filter(p => p.categorias && p.categorias[cat] != null);
  const vals = con.map(p => p.categorias[cat]);
  const med = mediana(vals), prom = promedio(vals);
  const orden = [...con].sort((a, b) => b.categorias[cat] - a.categorias[cat]);
  const nInv = peajes.filter(p => p.operador_tipo === 'INVIAS').length;

  document.getElementById('claves').innerHTML = `
    <li><b>${fmt(med)}</b><span>tarifa típica (mediana) para la categoría ${cat}</span></li>
    <li><b>${fmt(orden[0].categorias[cat])}</b><span>la más alta: ${tc(orden[0].nombre_display)}</span></li>
    <li><b>${nInv} de ${peajes.length}</b><span>peajes los cobra INVIAS</span></li>`;

  pintarDistribucion(con, cat, med, prom);
  pintarCategorias(cat);
  pintarOperadores(con, cat);
  pintarDepartamentos(cat);
  pintarExtremos(orden, cat);
}

/* 1. ¿Cuánto cuesta un peaje? — columnas por rango de $2.000 */
function pintarDistribucion(con, cat, med, prom) {
  const vals = con.map(p => p.categorias[cat]);
  const paso = 2000, ancho = 720, alto = 240, top = 46;
  const nb = Math.ceil((Math.max(...vals) + 1) / paso);
  const bins = Array.from({ length: nb }, (_, i) => ({ desde: i * paso, ps: [] }));
  con.forEach(p => bins[Math.floor(p.categorias[cat] / paso)].ps.push(p));
  const maxN = Math.max(...bins.map(b => b.ps.length));
  const bw = ancho / nb, colW = Math.min(24, bw - 4);
  const y = n => top + (alto - top) * (1 - n / maxN);
  const xm = v => v / (nb * paso) * ancho;
  const cada = Math.ceil(nb / 7);
  const etiqueta = b => `${fmt(b.desde)} a ${fmt(b.desde + paso - 1)}: ${b.ps.length} peaje${b.ps.length === 1 ? '' : 's'}`;

  document.getElementById('dist').innerHTML = `
    <svg viewBox="0 0 ${ancho} ${alto + 34}" role="img" aria-labelledby="distTitulo">
      <title id="distTitulo">Cantidad de peajes por rango de tarifa, categoría ${cat}. Mediana ${fmt(med)}.</title>
      ${bins.map((b, i) => b.ps.length ? `<g class="col" data-i="${i}" tabindex="0" role="img" aria-label="${etiqueta(b)}">
        <rect x="${i * bw}" y="0" width="${bw}" height="${alto}" fill="transparent"/>
        <path class="d" d="M${i * bw + (bw - colW) / 2},${alto} V${y(b.ps.length) + 4} q0,-4 4,-4 h${colW - 8} q4,0 4,4 V${alto} Z"/>
        <text class="n" x="${i * bw + bw / 2}" y="${y(b.ps.length) - 6}" text-anchor="middle">${b.ps.length}</text></g>` : '').join('')}
      <line class="eje" x1="0" x2="${ancho}" y1="${alto + 1}" y2="${alto + 1}"/>
      ${bins.filter((b, i) => i % cada === 0).map(b => `<text x="${xm(b.desde)}" y="${alto + 22}">${b.desde ? fmtMil(b.desde) : '$0'}</text>`).join('')}
      <g class="med"><line x1="${xm(med)}" x2="${xm(med)}" y1="0" y2="${alto}"/><text x="${xm(med) + 6}" y="12">mediana ${fmt(med)}</text></g>
    </svg>`;
  document.getElementById('explDist').innerHTML =
    `Cuántos peajes cobran cada rango de precio para la categoría ${cat}. La mitad cuesta menos de <b>${fmt(med)}</b>; el promedio es ${fmt(prom)}. Pasa el cursor (o el foco) por una columna para ver cuáles son.`;

  document.querySelectorAll('#dist g.col').forEach(g => {
    const b = bins[+g.dataset.i];
    const html = `<b>${etiqueta(b)}</b><br>${b.ps.slice(0, 6).map(p => tc(p.nombre_display)).join(', ')}${b.ps.length > 6 ? '…' : ''}`;
    g.addEventListener('mousemove', e => mostrarTip(e.clientX, e.clientY, html));
    g.addEventListener('mouseleave', ocultarTip);
    g.addEventListener('focus', () => { const r = g.getBoundingClientRect(); mostrarTip(r.left, r.top, html); });
    g.addEventListener('blur', ocultarTip);
  });
}

/* 2. ¿Cuánto más paga un camión? — tarifa promedio por categoría */
function pintarCategorias(cat) {
  const prom = Peajes.CATS.map(c => ({ c, v: promedio(peajes.map(p => p.categorias && p.categorias[c]).filter(v => v != null)) }));
  const max = Math.max(...prom.map(x => x.v));
  document.getElementById('cats').innerHTML = prom.map(x => `
    <li class="${x.c === cat ? 'on' : ''}"><span class="etq">${x.c} · ${Peajes.CORTO[x.c]}</span>
      <span class="pista"><span class="relleno" style="width:${x.v / max * 100}%"></span></span>
      <span class="val">${fmt(x.v)} <small>${veces(x.v / prom[0].v)}</small></span></li>`).join('');
}

/* 3. ¿INVIAS o concesión? */
function pintarOperadores(con, cat) {
  const lado = t => {
    const g = con.filter(p => p.operador_tipo === t);
    return { n: peajes.filter(p => p.operador_tipo === t).length, prom: g.length ? promedio(g.map(p => p.categorias[cat])) : null };
  };
  const inv = lado('INVIAS'), conc = lado('Concesión');
  const def = peajes.filter(p => p.operador_tipo === 'Por definir').length;
  document.getElementById('duo').innerHTML = `
    <div class="lado"><header>${Peajes.talanquera('invias', false, .8).svg}INVIAS</header><b>${inv.n} peajes</b><span>promedio ${fmt(inv.prom)} para la categoría ${cat}</span></div>
    <div class="lado"><header>${Peajes.talanquera('conc', false, .8).svg}Concesión</header><b>${conc.n} peajes</b><span>promedio ${fmt(conc.prom)} para la categoría ${cat}</span></div>`;
  document.getElementById('duoNota').textContent = def ? `Otros ${def} peajes tienen el operador por definir en el dataset de INVIAS.` : '';
}

/* 4. ¿Dónde hay más peajes? — los 10 departamentos con más peajes */
function pintarDepartamentos(cat) {
  const porDep = {};
  peajes.forEach(p => { if (p.departamento) (porDep[p.departamento] = porDep[p.departamento] || []).push(p); });
  const deps = Object.entries(porDep)
    .map(([d, ps]) => { const v = ps.map(p => p.categorias && p.categorias[cat]).filter(v => v != null); return { d, n: ps.length, prom: v.length ? promedio(v) : null }; })
    .sort((a, b) => b.n - a.n).slice(0, 10);
  document.getElementById('deptos').innerHTML = deps.map(x => `
    <li><span class="etq">${tc(x.d)}</span><span class="pista"><span class="relleno" style="width:${x.n / deps[0].n * 100}%"></span></span>
      <span class="val">${x.n} <small>· prom. ${fmt(x.prom)}</small></span></li>`).join('');
}

/* 5. Los extremos */
function pintarExtremos(orden, cat) {
  const fila = p => `<li>${Peajes.talanquera(Peajes.tipoClase(p), false, .8).svg}<span class="n">${tc(p.nombre_display)}, ${tc(p.departamento)}</span><span class="v">${fmt(p.categorias[cat])}</span></li>`;
  document.getElementById('caros').innerHTML = orden.slice(0, 6).map(fila).join('');
  document.getElementById('baratos').innerHTML = orden.slice(-6).reverse().map(fila).join('');
}

/* 6. Peajes muy seguidos — no depende de la categoría */
function pintarCercanos() {
  const conCoords = peajes.filter(p => p.lat != null && p.lon != null);
  const pares = [], vistos = new Set();
  conCoords.forEach(a => {
    let m = null, dm = Infinity;
    conCoords.forEach(b => { if (a !== b) { const d = km(a, b); if (d < dm) { dm = d; m = b; } } });
    const k = [a.id, m.id].sort().join('|');
    if (!vistos.has(k)) { vistos.add(k); pares.push({ a, b: m, d: dm }); }
  });
  document.getElementById('cerca').innerHTML = pares.sort((x, y) => x.d - y.d).slice(0, 6).map(x => `
    <li><span class="n">${tc(x.a.nombre_display)} y ${tc(x.b.nombre_display)}, ${tc(x.a.departamento)}</span>
      <span class="v">${x.d.toLocaleString('es-CO', { maximumFractionDigits: 1 })} km</span></li>`).join('');
}

init();
