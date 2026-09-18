# Peajes de Colombia

Mapa interactivo, calculador de ruta y dashboard de análisis sobre el inventario
de peajes de la Red Vial Nacional de Colombia, construido sobre datos abiertos
de INVIAS ([datos.gov.co](https://www.datos.gov.co/Transporte/Peajes/68qj-5xux)).

**Sitio en vivo:** https://donpe.github.io/peajes-colombia/

## Qué contiene

- **Mapa** ([docs/index.html](docs/index.html)) — los 179 peajes sobre un mapa real
  (OpenStreetMap), agrupados por cercanía, filtrables por departamento y tipo de
  operador, con ficha de detalle por peaje.
- **Ruta** ([docs/ruta.html](docs/ruta.html)) — calculadora de viaje: origen/destino
  con buscador predictivo de municipios, ruta trazada con Mapbox Directions (con
  tráfico en tiempo real y opción de evitar peajes), y los peajes que encuentra
  en el camino con su costo por categoría de vehículo.
- **Dashboard** ([docs/dashboard.html](docs/dashboard.html)) — análisis del
  inventario completo: distribución de tarifas, INVIAS vs. concesión, ranking de
  operadores y distancias entre peajes.
- **Acerca** ([docs/about.html](docs/about.html)) — fuentes de datos, qué se le
  hizo a los datos, herramientas usadas y limitaciones conocidas.

## Estructura del repositorio

```
Peajes_20260916.csv   Dataset original de INVIAS (snapshot 16 sep 2026)
scripts/               Pipeline de limpieza y transformación de datos (Python)
data/                  Datos limpios/derivados (JSON, CSV) + fuentes auxiliares en data/raw/
docs/                  El sitio web servido por GitHub Pages (HTML/CSS/JS estático)
```

## Pipeline de datos

```bash
python3 scripts/clean_data.py           # limpia el CSV de INVIAS -> data/peajes_clean.json
python3 scripts/assign_departamentos.py # asigna departamento por coordenada (DANE)
python3 scripts/build_municipios.py     # genera el buscador de municipios (DIVIPOLA)
```

Cada script está documentado en su propio encabezado con el porqué de sus decisiones.
Detalle completo en [docs/about.html](docs/about.html).

## Correr en local

```bash
cd docs && python3 -m http.server 8420
```

Y abrir `http://localhost:8420`.

## Fuentes de datos

- [Peajes — INVIAS vía datos.gov.co](https://www.datos.gov.co/Transporte/Peajes/68qj-5xux) (CC BY-SA 4.0)
- División político-administrativa y DIVIPOLA — DANE
- Mapas — [OpenStreetMap](https://www.openstreetmap.org/copyright)
- Ruteo — [Mapbox Directions](https://www.mapbox.com/directions)

Proyecto independiente de visualización de datos abiertos. No es un canal oficial de INVIAS.
