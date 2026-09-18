"""
Genera el dataset de municipios de Colombia para el buscador predictivo
del calculador de ruta (origen/destino).

Entradas:
  data/raw/co_municipios_dane.geojson
    DANE MGN 2018 MPIO_POLITICO, vía github.com/caticoa3/colombia_mapa
    (el mismo mirror que ya usamos para los límites departamentales).
    Da el límite de cada municipio y sirve de RESPALDO de coordenadas.

  data/raw/divipola_cabeceras.json
    DANE DIVIPOLA "Códigos cabeceras - Centros poblados" (datos.gov.co,
    id xaxy-8nri), filtrado a tipo_centro_poblado=CM (Cabecera Municipal).
    Da el punto real del casco urbano de cada municipio — esta es la
    fuente PRINCIPAL de coordenadas.

Salida:   web/data/municipios.json
          [{ n: "Florencia", d: "Caquetá", lat: .., lon: .. }, ...]
          (claves cortas a propósito: son ~1.122 registros que se cargan
          enteros en el navegador para la búsqueda instantánea)

Por qué dos fuentes, y por qué la cabecera es la principal:
  El centroide de ÁREA de un municipio grande e irregular (ej. Bogotá D.C.,
  que incluye la enorme zona rural de Sumapaz) queda muy lejos del casco
  urbano real, y usarlo como punto de partida de una ruta produce rutas
  y tiempos incorrectos (se probó: usar el centroide de área de Bogotá
  añadía ~50 km y ~1h de más en una ruta Bogotá–Tunja). La cabecera
  municipal (el punto donde de verdad está la ciudad/pueblo) es la
  referencia correcta para "de dónde sale un viaje". El centroide de
  área solo se usa como respaldo para los ~18 municipios (de 1.122) que
  no aparecen en el dataset de cabeceras.

El centroide de área se calcula sobre el polígono más grande de la
geometría de cada municipio (el "cuerpo principal", ignorando
islas/enclaves menores) con la fórmula estándar del centroide de un
polígono simple (shoelace) — no se usan librerías geoespaciales externas
(no están instaladas en este entorno).
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
SRC = BASE / "data" / "raw" / "co_municipios_dane.geojson"
CABECERAS_SRC = BASE / "data" / "raw" / "divipola_cabeceras.json"
OUT = BASE / "web" / "data" / "municipios.json"

NAME_FIX = {
    "BOGOTÁ, D.C.": "BOGOTÁ D.C.",
    "QUINDIO": "QUINDÍO",
}


def polygon_centroid_and_area(ring):
    """Centroide y área (con signo) de un anillo simple [ [lon,lat], ... ]."""
    a_sum = 0.0
    cx = 0.0
    cy = 0.0
    n = len(ring)
    for i in range(n - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        cross = x0 * y1 - x1 * y0
        a_sum += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    a_sum *= 0.5
    if abs(a_sum) < 1e-12:
        # polígono degenerado: promedio simple de vértices como respaldo
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0
    cx /= (6 * a_sum)
    cy /= (6 * a_sum)
    return cx, cy, abs(a_sum)


def geometry_centroid(geom):
    """Centroide del polígono de mayor área en la geometría (Polygon o MultiPolygon)."""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    best = None
    best_area = -1
    for poly in polys:
        outer = poly[0]
        cx, cy, area = polygon_centroid_and_area(outer)
        if area > best_area:
            best_area = area
            best = (cx, cy)
    return best


def title_case(s):
    s = s.replace(",", "")
    words = []
    for w in s.split():
        wl = w.lower()
        if wl in {"de", "la", "el", "los", "las", "y", "del"}:
            words.append(wl)
        elif "." in w:
            # siglas con puntos, ej. "D.C." -> mantener en mayúsculas
            words.append(w.upper())
        else:
            words.append(w.capitalize())
    # una palabra inicial nunca queda en minúscula (ej. "De" al comienzo de un nombre)
    if words:
        words[0] = words[0].capitalize() if "." not in words[0] else words[0]
    return " ".join(words)


def parse_divipola_coord(v):
    """"-75,581,775" -> -75.581775 : la primera coma es el separador decimal
    (formato colombiano), las comas siguientes son separadores de miles
    que el export del portal no debió incluir en una coordenada."""
    if "," not in v:
        return float(v)
    first, rest = v.split(",", 1)
    return float(first + "." + rest.replace(",", ""))


def load_cabeceras():
    """codigo_municipio (DIVIPOLA, 5 dígitos) -> (lat, lon) de la cabecera."""
    rows = json.load(open(CABECERAS_SRC, encoding="utf-8"))
    out = {}
    for r in rows:
        try:
            lon = parse_divipola_coord(r["longitud"])
            lat = parse_divipola_coord(r["latitud"])
        except (KeyError, ValueError):
            continue
        out[r["codigo_municipio"]] = (lat, lon)
    return out


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    cabeceras = load_cabeceras()

    out = []
    n_cabecera = 0
    n_centroide = 0
    for f in data["features"]:
        props = f["properties"]
        cod = props["MPIO_CCNCT"]
        if cod in cabeceras:
            lat, lon = cabeceras[cod]
            n_cabecera += 1
        else:
            lon, lat = geometry_centroid(f["geometry"])
            n_centroide += 1
        depto = NAME_FIX.get(props["DPTO_CNMBR"], props["DPTO_CNMBR"])
        out.append({
            "n": title_case(props["MPIO_CNMBR"]),
            "d": title_case(depto),
            "lat": round(lat, 5),
            "lon": round(lon, 5),
        })

    out.sort(key=lambda m: (m["n"], m["d"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"Municipios exportados: {len(out)}")
    print(f"  con punto de cabecera municipal (DIVIPOLA): {n_cabecera}")
    print(f"  con centroide de área (respaldo, sin cabecera en DIVIPOLA): {n_centroide}")
    print(f"Tamaño: {OUT.stat().st_size / 1024:.1f} KB")
    print("Ejemplos:", out[:3])


if __name__ == "__main__":
    main()
