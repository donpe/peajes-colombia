"""
Asigna un departamento de Colombia a cada peaje según sus coordenadas
(point-in-polygon), y exporta el bounding box de cada departamento para
poder hacer zoom en el mapa al seleccionarlo.

El dataset original de INVIAS no trae departamento como campo; solo trae
"Territorial" (una división administrativa interna de INVIAS que no
coincide con los departamentos). Por eso se cruza cada coordenada contra
los límites oficiales del DANE (MGN 2018, división político-administrativa).

Fuente de límites departamentales:
  data/raw/co_departamentos_dane.geojson
  (DANE MGN 2018 DPTO_POLITICO, vía github.com/caticoa3/colombia_mapa)

Entrada:  data/peajes_clean.json  (salida de clean_data.py)
Salidas:  data/peajes_clean.json        (actualizado, +campo "departamento")
          data/departamentos_bbox.json  (bbox [minLon,minLat,maxLon,maxLat] por depto)

No usa librerías geoespaciales externas (shapely/geopandas no están
instaladas en este entorno): implementa point-in-polygon por ray casting
a mano, suficiente para 179 puntos contra 33 polígonos departamentales.
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
PEAJES_PATH = BASE / "data" / "peajes_clean.json"
DEPTOS_PATH = BASE / "data" / "raw" / "co_departamentos_dane.geojson"
BBOX_OUT = BASE / "data" / "departamentos_bbox.json"

# Correcciones de nombre/tildes para que se vean consistentes en la UI
NAME_FIX = {
    "BOGOTÁ, D.C.": "BOGOTÁ D.C.",
    "QUINDIO": "QUINDÍO",
}


def ring_bbox(coords):
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lons), min(lats), max(lons), max(lats)


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi):
            inside = not inside
        j = i
    return inside


def point_in_polygon(x, y, geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        outer = poly[0]
        if point_in_ring(x, y, outer):
            if not any(point_in_ring(x, y, hole) for hole in poly[1:]):
                return True
    return False


def main():
    deptos = json.load(open(DEPTOS_PATH, encoding="utf-8"))["features"]
    for f in deptos:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        allpts = [pt for poly in polys for pt in poly[0]]
        f["_bbox"] = ring_bbox(allpts)
        name = f["properties"]["DPTO_CNMBR"]
        f["_name"] = NAME_FIX.get(name, name)

    def find_departamento(lon, lat):
        for f in deptos:
            minx, miny, maxx, maxy = f["_bbox"]
            if not (minx - 0.05 <= lon <= maxx + 0.05 and miny - 0.05 <= lat <= maxy + 0.05):
                continue
            if point_in_polygon(lon, lat, f["geometry"]):
                return f["_name"]
        return None

    peajes = json.load(open(PEAJES_PATH, encoding="utf-8"))
    sin_depto = []
    for p in peajes:
        if p["lat"] is None or p["lon"] is None:
            p["departamento"] = None
            continue
        dep = find_departamento(p["lon"], p["lat"])
        p["departamento"] = dep
        if dep is None:
            sin_depto.append(p["nombre_display"])

    # Único caso sin resolver en el snapshot original: un peaje portuario
    # (Bazurto/Manga, Cartagena) cuyas coordenadas caen sobre el agua,
    # fuera del polígono terrestre de Bolívar.
    for p in peajes:
        if p["departamento"] is None and p["nombre_display"] == "BAZURTO  (MANGA)":
            p["departamento"] = "BOLÍVAR"
            sin_depto.remove(p["nombre_display"])

    json.dump(peajes, open(PEAJES_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    dept_bbox = {f["_name"]: list(f["_bbox"]) for f in deptos}
    json.dump(dept_bbox, open(BBOX_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"Peajes sin departamento asignado: {len(sin_depto)} -> {sin_depto}")
    print(f"Departamentos con bbox exportado: {len(dept_bbox)}")


if __name__ == "__main__":
    main()
