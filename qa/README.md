# QA con Playwright

Pruebas de extremo a extremo de Peajes de Colombia. Corren contra `docs/` servido en local, en el Chrome instalado (Playwright no descarga navegadores), en dos perfiles: escritorio (1440×900) y teléfono (Pixel 7).

```bash
cd qa
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
npm test            # toda la suite, sin red externa
npm run reporte     # abre el reporte HTML
npm run grabar      # vuelve a pedir las rutas a Mapbox/OSRM y regraba fixtures/rutas.har
npm run test:live   # una ruta contra Mapbox en vivo
BASE_URL=https://donpe.github.io/peajes-colombia/ npm test   # contra el sitio publicado
```

**Red controlada.** Las teselas del mapa base se reemplazan por un PNG vacío. Mapbox Directions y OSRM se reproducen desde `fixtures/rutas.har`. Así las pruebas no dependen de la red, no gastan cuota y siempre dan los mismos peajes. El HAR se regraba cuando cambian el dataset o las rutas de prueba.

| Archivo | Qué cubre |
| --- | --- |
| `tests/viaje.spec.js` | Autocompletado (teclado, tildes, sin resultados), validación, ejemplos, tiquete (total = suma, numeración, un marcador por peaje, km crecientes), vehículo sin volver a pedir la ruta, evitar peajes, rutas alternas, peaje activo en el mapa, etiquetas sin choques, errores de Mapbox, OSRM o la red, redirecciones |
| `tests/mapa.spec.js` | Conteos de filtros, filtro por operador o departamento, combinación vacía, ficha (foco, Escape, URL), vehículo, enlaces `?peaje=` y `?depto=&tipo=`, URL inválida, lista en el teléfono |
| `tests/datos.spec.js` | Cifras clave, mediana correcta, histograma (ancho y suma), tooltip con teclado, orden de las listas |
| `tests/sitio.spec.js` | En las 4 páginas: consola sin errores, metadatos, un solo h1, sin desborde horizontal, axe (WCAG 2.2 AA), enlace para saltar al contenido, modo oscuro y capturas, enlaces internos, sitemap y robots. En el teléfono: orden de la portada y tamaño de los controles |
| `tests/anchos.spec.js` | Barrido de 14 anchos (320 a 1920, incluido el corte de 859/861 px) en Viaje, Mapa, Datos y Acerca. Revisa que nada se salga de la pantalla, que no haya texto cortado, que nombre y valor no se monten, que "Tu vehículo" quede en una fila, que el h1 no pase de 3 líneas y que el mapa tenga alto útil. Guarda una captura de cada ancho |
| `tests/datos-abiertos.spec.js` | Integridad del JSON: ids únicos, coordenadas en Colombia y en su departamento, tarifas válidas, categorías faltantes, tarifas incoherentes, duplicados, municipios |

Las capturas claras y oscuras quedan en `test-results/sitio-*-captura-*/` y las de cada ancho en `test-results/anchos-*/`, para revisarlas a ojo. Corren 3 Chrome a la vez y sin trazas, para no llenar el disco. `TRAZAS=1 npm test` guarda la traza de cada falla.
