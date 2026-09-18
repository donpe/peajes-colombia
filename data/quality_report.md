# Reporte de calidad de datos — Peajes Colombia

- Total de peajes procesados: **179**
- Operadores únicos tras normalización: **60** (de ~76 variantes de texto crudo)
- Por tipo de operador: INVIAS=39, Concesión=120, Por definir=20
- Coordenadas: 100% tomadas de la columna `point` (WKT), no de Latitud/Longitud sueltas,
  que estaban corruptas en 145/179 filas del original.

## Incidencias detectadas

- Sin tarifa Categoría I: SAN JUAN
- Sin tarifa Categoría I: TUNIA (SINIESTRADA)
- Sin tarifa Categoría I: LA NEVERA (NO OPERATIVO)
- Sin tarifa Categoría I: LOS SANTOS
- Sin tarifa Categoría I: URIBIA
- Sin tarifa Categoría I: VARIANTE LAS PALMAS
- Sin tarifa Categoría I: UNISABANA
- Sin tarifa Categoría I: ARANGUANEY (NO OPERATIVO)
