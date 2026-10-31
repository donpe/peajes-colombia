# Peajes de Colombia

Mapa interactivo, calculador de ruta y dashboard de análisis sobre el inventario
de peajes de la Red Vial Nacional de Colombia, construido sobre datos abiertos
de INVIAS ([datos.gov.co](https://www.datos.gov.co/Transporte/Peajes/68qj-5xux)).

**Sitio en vivo:** https://donpe.github.io/peajes-colombia/

## Qué contiene

- **Viaje** ([docs/index.html](docs/index.html)) — la portada: ¿cuánto pagas de
  peajes? Origen y destino con buscador predictivo de municipios, ruta trazada con
  Mapbox Directions (tráfico en tiempo real y opción de evitar peajes), y los peajes
  del camino dibujados como una vía recta con su kilómetro, más el total como tiquete.
- **Mapa** ([docs/mapa.html](docs/mapa.html)) — los 181 peajes sobre un mapa real
  (OpenStreetMap), filtrables por departamento y tipo de operador, con la tarifa
  visible al acercar y la ficha de cada peaje.
- **Datos** ([docs/dashboard.html](docs/dashboard.html)) — el inventario leído en
  conjunto: distribución de tarifas, cuánto más paga un camión, INVIAS frente a
  concesión, departamentos con más peajes, extremos y peajes muy seguidos.
- **Acerca** ([docs/about.html](docs/about.html)) — fuentes de datos, qué se le
  hizo a los datos, herramientas usadas y limitaciones conocidas.

En todas las páginas, **Tu vehículo** (categoría I a V) cambia los precios del
sitio entero y se recuerda entre visitas. Los enlaces viejos siguen funcionando:
`ruta.html?o=…&d=…` lleva a Viaje e `index.html?peaje=…` lleva al Mapa.

## Estructura del repositorio

```
Peajes_20261017.csv   Dataset original de INVIAS (versión del 19 sep 2026, descargada el 17 oct 2026)
scripts/               Pipeline de limpieza y transformación de datos (Python)
data/                  Datos limpios/derivados (JSON, CSV) + fuentes auxiliares en data/raw/
docs/                  El sitio web servido por GitHub Pages (HTML/CSS/JS estático)
```

## Pipeline de datos

```bash
python3 scripts/clean_data.py                      # limpia el CSV de INVIAS -> data/peajes_clean.json
python3 scripts/assign_departamentos.py            # asigna departamento por coordenada (DANE)
python3 scripts/aplicar_correcciones_tarifarias.py # corrige tarifas que INVIAS tiene desactualizadas, con fuente citada
python3 scripts/agregar_peajes_faltantes.py        # agrega peajes reales ausentes del inventario de INVIAS, con fuente citada
python3 scripts/consolidar_duplicados.py           # fusiona filas que INVIAS trae duplicadas como si fueran dos peajes, con fuente citada
python3 scripts/build_municipios.py                # genera el buscador de municipios (DIVIPOLA)
```

⚠️ El orden importa: `aplicar_correcciones_tarifarias.py`, `agregar_peajes_faltantes.py` y
`consolidar_duplicados.py` deben correr **después** de `clean_data.py` (y de
`assign_departamentos.py`, si se corre), porque parten de `data/peajes_clean.json` ya generado.
Después de correr el pipeline, copiar `data/peajes_clean.json` a `docs/data/peajes_clean.json` para publicar los cambios.

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
- Mapas — datos de [OpenStreetMap](https://www.openstreetmap.org/copyright), estilo Navigation de [Mapbox](https://www.mapbox.com/about/maps/)
- Ruteo — [Mapbox Directions](https://www.mapbox.com/directions)
- Verificación de nombre de vía en Ruta — [OSRM](https://project-osrm.org) `/nearest` (servidor público, solo para esta consulta auxiliar)

Proyecto independiente de visualización de datos abiertos. No es un canal oficial de INVIAS.
