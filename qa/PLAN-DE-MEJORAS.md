# Plan de mejoras, QA del 3 de noviembre de 2026

## Estado después de los arreglos

**300 pruebas: 222 pasan, 0 fallan y 78 se omiten a propósito.** De las omitidas, 56 son el barrido de anchos, que solo corre en escritorio porque fija su propio ancho. Las demás aplican solo al teléfono, solo a escritorio o a Mapbox en vivo.

| # | Qué | Estado |
| --- | --- | --- |
| 1 | "Failed to fetch" sin red | Arreglado: ahora dice "No hay conexión con el servicio de rutas…" |
| 2 | La lista "Sin resultados" no se cerraba con Escape y tapaba Calcular | Arreglado: Escape la cierra y el aviso va bajo el campo, sin flotar |
| 3 | Escribir "Armenia, Quindío" no encontraba nada | Arreglado: lo que va después de la coma filtra el departamento |
| 4–5 | Tarifas incoherentes y peajes sin categorías | **Sigue pendiente.** Se revisó el CSV de INVIAS y los valores vienen así de la fuente. No se encontró una resolución con la cifra correcta, así que no se tocaron, según la regla de no inventar valores. Quedan como casos conocidos en `datos-abiertos.spec.js`, que falla solo si aparece uno nuevo |
| 6 | Marcadores por debajo de 24 px | Arreglado: el área de toque mide al menos 24×24. Los peajes de fondo de la portada son solo dibujo con el mapa lejos y se vuelven tocables desde el zoom 9. Los peajes de la ruta usan la excepción "equivalente" (2.5.8), porque cada uno tiene su fila en el tiquete |
| 7 | Controles bajos en el teléfono | Arreglado: "Evitar vías de peaje" y "Ver los 181 peajes" miden 44 px |
| 8 | La leyenda se veía por el borde de la ficha | Arreglado: se esconde mientras la ficha está abierta |
| 9 | Las talanqueras tapaban el nombre del origen | Arreglado: origen y destino van encima de los peajes |
| nuevo | En el teléfono la ruta ocupaba una cuarta parte del mapa | Arreglado: en mapas angostos se encuadra justo, con margen arriba y a la derecha y medio nivel de zoom |

Lo que sigue pendiente: 4–5 (consultar la fuente) y 10–14 (proceso de QA).

---

Diagnóstico original:

Corrida: **188 pruebas en escritorio y teléfono. 150 pasan, 16 fallan y 22 se omiten a propósito** (pruebas solo para el teléfono, solo para escritorio o en vivo). Duración: 5,6 min. Las 16 fallas son problemas reales del sitio o de los datos, no de las pruebas. Cada una queda en verde cuando se corrige.

Funciona bien:
- El tiquete cuadra en las rutas probadas: el total es la suma de las tarifas, la numeración va seguida y hay un marcador por peaje.
- Cambiar de vehículo recalcula sin volver a llamar a Mapbox.
- Las rutas alternas, "evitar peajes", los enlaces compartidos y las redirecciones funcionan.
- Los filtros del mapa cuadran con los 181 peajes.
- Los números del mapa no se montan, incluso con 11 peajes.
- No hay errores de consola, ni enlaces rotos, ni desborde horizontal en el teléfono.
- El modo oscuro funciona.
- axe no encuentra contraste insuficiente ni etiquetas faltantes.

## P1. Errores que la gente encuentra

1. **Sin conexión, el viaje muestra "Failed to fetch".** El `catch` de `calcularRuta` ([ruta.js:497](../docs/ruta.js)) muestra el mensaje técnico del navegador.
   *Arreglo:* si el error es un `TypeError` de `fetch`, mostrar "No hay conexión con el servicio de rutas. Revisa tu internet e intenta de nuevo."
   *Prueba:* `errores del servicio › sin red`.

2. **La lista "Sin resultados" no se cierra con Escape y en el teléfono tapa el botón Calcular.** El `keydown` sale antes de mirar la tecla cuando no hay sugerencias (`if (list.hidden || !items.length) return;`, [ruta.js:161](../docs/ruta.js)). En el teléfono la lista vacía queda encima de Calcular y el primer toque se pierde.
   *Arreglo:* atender Escape antes de esa salida. Con cero resultados, mostrar el aviso como texto bajo el campo y no como lista flotante.
   *Pruebas:* `avisa cuando no hay resultados…` y `la lista abierta no tapa el botón Calcular`.

3. **Escribir o pegar "Armenia, Quindío" da "Sin resultados".** `buscarMunicipios` compara solo con el nombre del municipio ([ruta.js:94](../docs/ruta.js)), y el texto que el propio sitio pone en el campo es "municipio, departamento". Pasa también al corregir un campo ya lleno.
   *Arreglo:* buscar sobre `etiqueta(m)`, o separar por la coma y filtrar el departamento con lo que va después.
   *Prueba:* `escribir "municipio, departamento" completo…`.

## P1. Datos por verificar con INVIAS

4. **Dos tarifas incoherentes:**
   - `laureano-gomez`: categoría II $1.200, entre I $10.100 y III $28.100. Parece un cero perdido.
   - `macheta`: III y IV $11.800, menos que II $20.500.

   *Arreglo:* contrastar con la resolución tarifaria. Si es un error de la fuente, corregirlo en `scripts/` con una nota y no a mano en el JSON.

5. **12 peajes sin alguna categoría I–V.**
   - Sin ninguna: `tunia-siniestrada`, `la-nevera-no-operativo`, `los-santos`, `uribia`, `aranguaney-no-operativo`.
   - Faltan varias: `turbaco` (sin I y II) y `unisabana` (sin I a IV).
   - Solo falta la III: `corredor-portuario`, `quiebra-de-velez`, `la-estrella`, `bazurto-manga` y `ceballos`.

   Los "no operativo" o "siniestrada" aparecen en el mapa como cualquier otro peaje y siguen dentro de los "181 peajes" del texto.
   *Arreglo:* agregar un campo `estado` (operativo / no operativo) y mostrarlo en la ficha y en la lista. Decidir si cuentan en el total que anuncia el sitio.

## P2. Accesibilidad

6. **Marcadores del mapa por debajo de 24×24 px (WCAG 2.5.8, axe "serious").** Los peajes de fondo en Viaje (escala 0,6, unos 18×12 px) y algunos del mapa no alcanzan el tamaño mínimo: 167 nodos en escritorio y 134 en el teléfono.
   *Arreglo:* un área de toque invisible de 24×24 o más en `.mk`, por ejemplo un `::before` centrado, sin cambiar el dibujo.

7. **Controles bajos en el teléfono.** "Evitar vías de peaje" mide 21 px de alto y su casilla 18 px. "Ver los 181 peajes en el mapa" también mide 21 px.
   *Arreglo:* `padding-block` en `.evitar` y `.ir-mapa` hasta unos 44 px de área tocable.

## P2. Detalles visuales vistos en las capturas

8. **Ficha del mapa en el teléfono:** el texto de la leyenda ("Acerca el mapa para ver las tarifas") se ve a través del borde dentado inferior de la ficha. Además, la ficha tapa el botón "Ver la lista de peajes".
   *Arreglo:* fondo sólido bajo el dentado, o esconder la leyenda mientras la ficha está abierta.

9. **Etiqueta de origen tapada en el teléfono:** en Medellín → San Agustín las talanqueras cubren "Medellín", que se lee "lín". `despejarEtiquetas` evita que los números y las tarifas choquen con las ciudades, pero no evita los íconos.
   *Arreglo:* subir el `z-index` de `.mk-extremo` por encima de los peajes, o ocultar el nombre del extremo cuando choca y dejar solo el cuadro.

## P3. Proceso de QA

10. **Correr la suite en cada push:** un GitHub Action con `npm test`. Los runners de Ubuntu ya traen Chrome, así que sirve `channel: 'chrome'`. Puede bloquear la publicación si falla.
11. **Regresión visual:** con las teselas vacías, las capturas son estables. Se puede pasar de capturas para revisar a `toHaveScreenshot` con referencias.
12. **Regrabar `fixtures/rutas.har`** (`npm run grabar`) cada vez que cambie `peajes_clean.json`, y correr `npm run test:live` cada semana para saber si Mapbox o OSRM cambiaron algo.
13. **OSRM público** ([router.project-osrm.org](https://router.project-osrm.org)) no tiene acuerdo de servicio y hace unas 17 llamadas por ruta. Si cae, el sitio sigue funcionando (hay prueba), pero con un criterio de coincidencia más estricto. Vale la pena vigilarlo o dejar de depender de él.
14. Confirmar en el panel de Mapbox que el token está **restringido al dominio** `donpe.github.io`, más `localhost` para pruebas.

## Orden sugerido

Primero 1, 2 y 3: son cambios cortos en `ruta.js` y ya tienen prueba. Luego 6 a 9, sobre todo CSS. Después 4 y 5, que necesitan consultar la fuente. Por último 10 a 14.
