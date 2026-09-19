"""
Consolida peajes que el inventario de INVIAS trae duplicados como dos filas
distintas cuando en realidad son una sola estación (a diferencia de
correcciones_tarifas_2026.json, que corrige una fila que sí es real, o
adiciones_peajes_2026.json, que agrega una fila real ausente).

Por qué existe: se detectó el caso "EL PLACER" / "EL PLACER 2" (Nariño,
vía Rumichaca-Pasto) al investigar por qué el calculador de Ruta no podía
distinguirlos por nombre de vía real — ambos están sobre la misma
Carretera Panamericana, a solo 2.6km. La Resolución 20253040025055 de
2025 del Ministerio de Transporte y OpenStreetMap confirman que solo
existe UNA estación de peaje "El Placer". Ver el detalle completo y las
fuentes de cada consolidación en data/raw/consolidacion_el_placer_2026.json
— igual que con correcciones y adiciones, no se fusiona nada sin fuente
primaria citada.

Entrada:  data/raw/consolidacion_el_placer_2026.json
          data/peajes_clean.json
Salida:   data/peajes_clean.json (con la fila "id_eliminar" removida y la
          fila "id_conservar" actualizada con campos_finales + categorias)
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CONSOLIDACIONES = [
    BASE / "data" / "raw" / "consolidacion_el_placer_2026.json",
]
PEAJES_PATH = BASE / "data" / "peajes_clean.json"


def main():
    peajes = json.load(open(PEAJES_PATH, encoding="utf-8"))
    por_id = {p["id"]: p for p in peajes}

    for ruta in CONSOLIDACIONES:
        c = json.load(open(ruta, encoding="utf-8"))
        conservar, eliminar = c["id_conservar"], c["id_eliminar"]

        if eliminar not in por_id:
            print(f"'{eliminar}' ya no existe — ¿ya se corrió esta consolidación antes?")
            continue
        if conservar not in por_id:
            print(f"ADVERTENCIA: '{conservar}' no existe en el inventario, se omite.")
            continue

        p = por_id[conservar]
        p.update(c["campos_finales"])
        p["categorias"] = c["categorias"]
        p["tarifa_cat1"] = c["categorias"].get("I")

        peajes = [x for x in peajes if x["id"] != eliminar]
        por_id.pop(eliminar)
        print(f"Consolidado: '{eliminar}' fusionado en '{conservar}' — {c['fuente_unicidad'][:70]}...")

    json.dump(peajes, open(PEAJES_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nTotal en el inventario: {len(peajes)}")


if __name__ == "__main__":
    main()
