"""
Aplica correcciones manuales a tarifas específicas que el dataset de INVIAS
(datos.gov.co, id 68qj-5xux) tiene desactualizadas o incompletas.

Por qué existen estas correcciones:
  El inventario de INVIAS incluye peajes que en realidad no administra ni
  tarifica INVIAS directamente — varios de la zona Medellín-Oriente
  antioqueño (Santa Elena, Variante Las Palmas, Pajarito) están a cargo de
  concesiones departamentales de la Gobernación de Antioquia, que ajusta
  sus tarifas por decreto cada enero según el IPC. El snapshot de INVIAS
  usado en este proyecto no refleja el ajuste de enero de 2026: para
  Santa Elena queda con una tarifa vieja, y Variante Las Palmas queda con
  todas las categorías en 0 (sin dato).

  Se detectó este caso el 18 de septiembre de 2026 al validar manualmente
  el mapa contra la zona de Rionegro, y se corrigió consultando las fuentes
  oficiales de cada decreto (ver data/raw/correcciones_tarifas_2026.json
  para el detalle y el link de cada una).

Principio: nunca se inventa un valor. Solo se corrige una categoría cuando
hay una fuente primaria (el decreto, o una nota de prensa que cita
explícitamente el decreto) con esa cifra exacta. Las categorías sin fuente
verificada se dejan como estaban en el dato original de INVIAS.

Entrada:  data/raw/correcciones_tarifas_2026.json
          data/peajes_clean.json (salida de clean_data.py + assign_departamentos.py)
Salida:   data/peajes_clean.json (actualizado)
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CORRECCIONES_PATH = BASE / "data" / "raw" / "correcciones_tarifas_2026.json"
PEAJES_PATH = BASE / "data" / "peajes_clean.json"


def main():
    correcciones = json.load(open(CORRECCIONES_PATH, encoding="utf-8"))["correcciones"]
    peajes = json.load(open(PEAJES_PATH, encoding="utf-8"))
    por_id = {p["id"]: p for p in peajes}

    for c in correcciones:
        p = por_id.get(c["peaje_id"])
        if not p:
            print(f"AVISO: no se encontró el peaje '{c['peaje_id']}' — se omite esta corrección.")
            continue
        antes = dict(p["categorias"])
        p["categorias"].update(c["categorias"])
        p["tarifa_cat1"] = p["categorias"].get("I")
        print(f"{c['peaje_id']}: {antes} -> {p['categorias']}  ({c['fuente'][:70]}...)")

    json.dump(peajes, open(PEAJES_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n{len(correcciones)} corrección(es) aplicada(s) sobre {PEAJES_PATH}")


if __name__ == "__main__":
    main()
