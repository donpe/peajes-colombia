"""
Limpieza y estructuración del inventario de peajes de Colombia (INVIAS).

Entrada:  Peajes_20260916.csv (fuente: hermes.invias.gov.co)
Salidas:  data/peajes_clean.csv   -- tabla plana, una fila por peaje
          data/peajes_clean.json  -- mismo contenido, para consumo web
          data/quality_report.md  -- resumen de problemas encontrados/corregidos

Reglas de limpieza aplicadas:
  1. Coordenadas: se usa SIEMPRE la columna `point` (WKT "POINT (lon lat)"),
     porque las columnas sueltas Latitud/Longitud están corruptas en 145/179
     filas (duplicadas entre sí o en 0,0).
  2. Tarifas: strings tipo "12,200" (coma = separador de miles) -> int.
     "0" se interpreta como "no aplica / exento" -> None, para no mezclarlo
     con tarifas reales bajas.
  3. Operador: se normaliza `Responsable` (trim, capitalización, acentos,
     variantes de "Concesión/Concesion/CONCESIÓN") y se agrupan variantes
     del mismo operador bajo un nombre canónico. Se clasifica operator_type
     en INVIAS / Concesión / Por definir según el nombre resultante.
     (La columna `Administrador`, código 1-5, no es confiable como fuente
     de este dato: un mismo código mapea a decenas de operadores distintos.)
  4. Nombres de peaje duplicados (ej. "SAN PEDRO" x2) se desambiguan
     agregando el departamento/tramo entre paréntesis en un campo aparte,
     manteniendo el nombre original intacto.
  5. Teléfonos y responsables vacíos o "Por Definir" se normalizan a None.
  6. Se conserva un id estable (slug) por peaje para usarlo en la app web.
"""
import csv
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
SRC = BASE / "Peajes_20260916.csv"
OUT_DIR = BASE / "data"
OUT_DIR.mkdir(exist_ok=True)

CATEGORY_COLS = [
    "Categoria I", "Categoria II", "Categoria III", "Categoria IV", "Categoria V",
    "Categoria VI", "Categoria VII", "Categoria VIII", "Categoria IX",
    "Categoria E", "Categoria EAE", "Categoria EC", "Categoria EIE", "Categoria IE",
    "Categoria IEE", "Categoria IEEE", "Categoria IEX", "Categoria IIA",
    "Categoria IIE", "Categoria IIIE", "Categoria IVE", "Categoria VE",
    "Categoria VIE", "Categoria VIIE",
]

POINT_RE = re.compile(r"POINT \(([-\d.]+) ([-\d.]+)\)")


def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


GENERIC_SUFFIXES = re.compile(
    r"\b(s\.?a\.?s\.?|s\.?a\.?|ltda\.?)\b\.?"
)


def norm_key(s: str) -> str:
    """Clave de agrupación: minúsculas, sin acentos/puntuación/prefijo "concesión"/
    sufijos societarios genéricos, espacios colapsados. Así "Concesión Autopistas
    del Café" y "Autopistas del Café S.A.S" agrupan bajo la misma clave."""
    s = strip_accents(s or "").lower()
    s = re.sub(r"[.,\-–—]", " ", s)
    s = re.sub(r"^(concesionaria|concesion)\b", "", s).strip()
    s = GENERIC_SUFFIXES.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def slugify(s: str) -> str:
    s = strip_accents(s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def parse_money(v: str):
    v = (v or "").replace(",", "").strip()
    if not v:
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return int(f) if f > 0 else None  # 0 = no aplica / exento -> None


def parse_point(point_str: str):
    m = POINT_RE.match(point_str or "")
    if not m:
        return None, None
    lon, lat = float(m.group(1)), float(m.group(2))
    return lat, lon


def clean_text(v: str):
    v = (v or "").strip()
    if not v or v.lower() in {"por definir", "n/a", "na", "-"}:
        return None
    return re.sub(r"\s+", " ", v)


def build_operator_lookup(rows):
    """Agrupa variantes de nombre de operador bajo un nombre canónico
    (el más frecuente dentro del grupo, para preservar mayúsculas usuales)."""
    groups = defaultdict(list)
    for r in rows:
        raw = clean_text(r["Responsable"])
        if raw is None:
            continue
        groups[norm_key(raw)].append(raw)

    canonical = {}
    for key, variants in groups.items():
        # nombre más frecuente; en empate, el más corto (suele ser el más "limpio")
        counts = defaultdict(int)
        for v in variants:
            counts[v] += 1
        best = sorted(counts.items(), key=lambda kv: (-kv[1], len(kv[0])))[0][0]
        canonical[key] = best
    return canonical


def operator_type(name: str) -> str:
    """En este dataset todo operador que no sea INVIAS es una concesión privada."""
    if name is None:
        return "Por definir"
    n = strip_accents(name).lower()
    return "INVIAS" if ("invias" in n or "vipsa" in n) else "Concesión"


def main():
    with open(SRC, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    operator_lookup = build_operator_lookup(rows)

    name_counts = defaultdict(int)
    for r in rows:
        name_counts[clean_text(r["Nombre Peaje"])] += 1

    seen_name_idx = defaultdict(int)
    clean_rows = []
    issues = []

    for r in rows:
        lat, lon = parse_point(r["point"])
        name = clean_text(r["Nombre Peaje"]) or "SIN NOMBRE"

        # desambiguar nombres duplicados
        display_name = name
        if name_counts[name] > 1:
            seen_name_idx[name] += 1
            display_name = f"{name} ({r['Sector'].strip() or r['Ubicación'].strip()})"

        responsable_raw = clean_text(r["Responsable"])
        operator = operator_lookup.get(norm_key(responsable_raw)) if responsable_raw else None

        categorias = {}
        for col in CATEGORY_COLS:
            val = parse_money(r[col])
            if val is not None:
                key = col.replace("Categoria ", "")
                categorias[key] = val

        clean = {
            "id": slugify(display_name) or slugify(r["Código Peaje"]) or f"peaje-{len(clean_rows)+1}",
            "nombre": name,
            "nombre_display": display_name,
            "lat": lat,
            "lon": lon,
            "ubicacion": clean_text(r["Ubicación"]),
            "sector": clean_text(r["Sector"]),
            "sentido": clean_text(r["Sentido"]),
            "pr": clean_text(r["Poste de Referencia PR"]),
            "distancia_pr_m": clean_text(r["Distancia PR"]),
            "telefono_grua": clean_text(r["Telefono Grúa"]),
            "telefono_peaje": clean_text(r["Telefono Peaje"]),
            "url_ficha": clean_text(r["URL Foto"]),
            "categorias": categorias,
            "tarifa_cat1": categorias.get("I"),
            "operador": operator,
            "operador_tipo": operator_type(operator),
            "codigo_peaje": clean_text(r["Código Peaje"]),
            "codigo_tramo": clean_text(r["Código Tramo"]),
            "territorial": clean_text(r["Territorial"]),
        }

        if lat is None or lon is None:
            issues.append(f"Sin coordenadas válidas: {display_name}")
        if clean["tarifa_cat1"] is None:
            issues.append(f"Sin tarifa Categoría I: {display_name}")

        clean_rows.append(clean)

    # --- salidas ---
    json_path = OUT_DIR / "peajes_clean.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(clean_rows, f, ensure_ascii=False, indent=2)

    csv_path = OUT_DIR / "peajes_clean.csv"
    flat_fields = [
        "id", "nombre", "nombre_display", "lat", "lon", "ubicacion", "sector",
        "sentido", "pr", "distancia_pr_m", "telefono_grua", "telefono_peaje",
        "url_ficha", "tarifa_cat1", "operador", "operador_tipo", "codigo_peaje",
        "codigo_tramo", "territorial",
    ]
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=flat_fields, extrasaction="ignore")
        w.writeheader()
        for row in clean_rows:
            w.writerow(row)

    n_operadores = len({r["operador"] for r in clean_rows if r["operador"]})
    n_invias = sum(1 for r in clean_rows if r["operador_tipo"] == "INVIAS")
    n_conc = sum(1 for r in clean_rows if r["operador_tipo"] == "Concesión")
    n_pordef = sum(1 for r in clean_rows if r["operador_tipo"] == "Por definir")

    report_path = OUT_DIR / "quality_report.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("# Reporte de calidad de datos — Peajes Colombia\n\n")
        f.write(f"- Total de peajes procesados: **{len(clean_rows)}**\n")
        f.write(f"- Operadores únicos tras normalización: **{n_operadores}** (de ~76 variantes de texto crudo)\n")
        f.write(f"- Por tipo de operador: INVIAS={n_invias}, Concesión={n_conc}, Por definir={n_pordef}\n")
        f.write(f"- Coordenadas: 100% tomadas de la columna `point` (WKT), no de Latitud/Longitud sueltas,\n")
        f.write(f"  que estaban corruptas en 145/179 filas del original.\n\n")
        f.write("## Incidencias detectadas\n\n")
        for issue in issues:
            f.write(f"- {issue}\n")

    print(f"OK -> {json_path}")
    print(f"OK -> {csv_path}")
    print(f"OK -> {report_path}")
    print(f"\nPeajes: {len(clean_rows)} | Operadores únicos: {n_operadores} | "
          f"INVIAS={n_invias} Concesión={n_conc} Por definir={n_pordef}")
    print(f"Incidencias: {len(issues)}")


if __name__ == "__main__":
    main()
