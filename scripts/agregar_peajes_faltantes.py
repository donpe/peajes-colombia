"""
Agrega al inventario peajes reales que NO existen en el dataset de INVIAS
en absoluto (a diferencia de aplicar_correcciones_tarifarias.py, que
corrige filas que sí existen pero con datos viejos/incompletos).

Por qué existe: el peaje "Sajonia" (Túnel de Oriente, Medellín-Rionegro)
nunca se cargó al inventario de INVIAS, así que el calculador de Ruta no
lo detectaba en la ruta principal Medellín-Rionegro. Ver el detalle y la
fuente exacta de cada adición en data/raw/adiciones_peajes_2026.json —
igual que con las correcciones de tarifas, no se agrega nada sin una
fuente primaria citada (coordenadas + tarifa).

Cada peaje agregado usa el mismo esquema de campos que produce
clean_data.py, para que el resto del pipeline (departamentos, app web)
lo trate exactamente igual que un peaje de INVIAS. Los campos que no
aplican a un peaje que no es de INVIAS (código de peaje, tramo,
territorial, sentido, poste de referencia) quedan en null.

Entrada:  data/raw/adiciones_peajes_2026.json
          data/peajes_clean.json
Salida:   data/peajes_clean.json (con la(s) fila(s) nueva(s) al final)
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
ADICIONES_PATH = BASE / "data" / "raw" / "adiciones_peajes_2026.json"
PEAJES_PATH = BASE / "data" / "peajes_clean.json"


def main():
    adiciones = json.load(open(ADICIONES_PATH, encoding="utf-8"))["adiciones"]
    peajes = json.load(open(PEAJES_PATH, encoding="utf-8"))
    ids_existentes = {p["id"] for p in peajes}

    agregados = 0
    for a in adiciones:
        if a["id"] in ids_existentes:
            print(f"'{a['id']}' ya existe en el inventario — se omite (¿ya se corrió este script antes?).")
            continue

        nuevo = {
            "id": a["id"],
            "nombre": a["nombre"],
            "nombre_display": a["nombre_display"],
            "lat": a["lat"],
            "lon": a["lon"],
            "ubicacion": a.get("ubicacion"),
            "sector": a.get("sector"),
            "sentido": None,
            "pr": None,
            "distancia_pr_m": None,
            "telefono_grua": None,
            "telefono_peaje": None,
            "url_ficha": None,
            "categorias": a["categorias"],
            "tarifa_cat1": a["categorias"].get("I"),
            "operador": a["operador"],
            "operador_tipo": a["operador_tipo"],
            "codigo_peaje": None,
            "codigo_tramo": None,
            "territorial": None,
            "departamento": a["departamento"].upper(),
        }
        peajes.append(nuevo)
        ids_existentes.add(a["id"])
        agregados += 1
        print(f"Agregado: {a['nombre_display']} ({a['lat']}, {a['lon']}) — {a['fuente_tarifa'][:60]}...")

    json.dump(peajes, open(PEAJES_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n{agregados} peaje(s) agregado(s). Total en el inventario: {len(peajes)}")


if __name__ == "__main__":
    main()
