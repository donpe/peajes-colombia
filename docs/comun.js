/* Peajes de Colombia — piezas compartidas por todas las páginas:
   "Tu vehículo" (la categoría elegida, que cambia los precios en todo el
   sitio), el marcador de talanquera y los formatos de número y nombre. */

const Peajes = (() => {
  const CATS = ['I', 'II', 'III', 'IV', 'V'];
  const CAT = {
    I: 'automóvil, campero, camioneta', II: 'bus o camión de 2 ejes', III: 'camión de 3 ejes',
    IV: 'camión de 4 ejes', V: 'camión de 5 o más ejes',
  };
  const CORTO = { I: 'automóvil', II: 'bus o 2 ejes', III: '3 ejes', IV: '4 ejes', V: '5 o más ejes' };

  const fmtNum = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  const fmt = n => n == null ? '—' : '$' + fmtNum.format(Math.round(n));

  // INVIAS publica los nombres en mayúsculas; se muestran en tipo oración,
  // con artículos y preposiciones en minúscula ("Túnel de la Línea")
  const MENORES = new Set(['de', 'la', 'del', 'el', 'los', 'las', 'y', 'en']);
  const ROMANOS = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/;   // "Tarapacá II", no "Tarapacá Ii"
  const tc = s => (s || '').toLowerCase().replace(/(^|\s|\(|-|\/)([a-záéíóúñü]+)/g,
    (m, a, w) => a + (a !== '' && ROMANOS.test(w) ? w.toUpperCase()
      : a === ' ' && MENORES.has(w) ? w : w[0].toUpperCase() + w.slice(1)));

  const tipoClase = p => p.operador_tipo === 'INVIAS' ? 'invias' : p.operador_tipo === 'Concesión' ? 'conc' : 'def';

  /* ---- Tu vehículo: URL (?cat=) > lo último que eligió esta persona > I ---- */
  const CLAVE = 'peajes.cat';
  function leerCat() {
    const q = new URLSearchParams(location.search).get('cat');
    if (CATS.includes(q)) return q;
    try { const g = localStorage.getItem(CLAVE); if (CATS.includes(g)) return g; } catch (e) { /* sin almacenamiento */ }
    return 'I';
  }
  let cat = leerCat();

  function setCat(c) {
    if (!CATS.includes(c) || c === cat) return;
    cat = c;
    try { localStorage.setItem(CLAVE, c); } catch (e) { /* sin almacenamiento */ }
    document.querySelectorAll('.vehiculo input').forEach(r => { r.checked = r.value === c; });
    document.dispatchEvent(new CustomEvent('peajes:cat', { detail: c }));
  }

  function montarVehiculo() {
    document.querySelectorAll('.vehiculo input').forEach(r => {
      r.checked = r.value === cat;
      r.addEventListener('change', () => setCat(r.value));
    });
  }

  /* ---- Marcador: la talanquera (poste + pluma de la barrera) ----
     La pluma lleva rayas como una barrera real; el relleno distingue al
     operador: oscura = INVIAS, blanca = concesión, gris = por definir,
     amarilla = seleccionada. Colores por clase CSS, para el modo oscuro. */
  function talanquera(tipo, on, escala = 1) {
    const w = 30 * escala, h = 20 * escala;
    const c = on ? 'on' : tipo;
    return {
      w, h, ax: 4 * escala, ay: h,
      svg: `<svg class="tq ${c}" width="${w}" height="${h}" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
        <rect class="tq-poste" x="1" y="3" width="7" height="16" rx="1"/>
        <rect class="tq-pluma" x="6" y="4" width="23" height="7"/>
        <path class="tq-raya" d="M12 4.8l3.4 5.4M18.6 4.8l3.4 5.4M25 4.8l2.6 4.2"/></svg>`,
    };
  }

  // Ícono de Leaflet: la talanquera y, si se pide, la tarifa de la categoría activa al lado
  function icono(p, { on = false, precio = false, escala } = {}) {
    const t = talanquera(tipoClase(p), on, escala || (on ? 1.3 : 1));
    const valor = p.categorias && p.categorias[cat] != null ? fmt(p.categorias[cat]) : 'sin tarifa';
    const etiqueta = precio ? `<span class="mk-precio${on ? ' on' : ''}" style="left:${t.w + 4}px;top:${Math.max(0, t.h / 2 - 12)}px">${valor}</span>` : '';
    return L.divIcon({ className: 'mk', html: t.svg + etiqueta, iconSize: [t.w, t.h], iconAnchor: [t.ax, t.ay], popupAnchor: [0, -t.h] });
  }

  // Mapa base en gris, para que las talanqueras y la ruta sean lo único con color
  function capaBase(mapa) {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(mapa);
  }

  document.addEventListener('DOMContentLoaded', montarVehiculo);

  return {
    CATS, CAT, CORTO, fmt, tc, tipoClase, talanquera, icono, capaBase, setCat,
    get cat() { return cat; },
  };
})();
