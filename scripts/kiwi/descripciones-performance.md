# Descripciones de los casos de performance (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                                                                       |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 23/11/2026 | TC-P-001 pasa de 70 a 20 sesiones, como la Línea de Base. TC-P-004: editor del mapa de mesas con 20 mesas a 30 FPS o más (HU-016, RD.05). Primer archivo de descripciones de performance (BL-607). |

Texto del campo de descripción de cada caso TC-P en Kiwi, en el Test Plan
«Performance-k6-Lighthouse». Lo carga
`cargar-casos-integracion.mjs --performance --descripciones`: cada bloque
`## TC-P-NNN` reemplaza la descripción de ese caso, y solo si cambió. Los
casos que no están en este archivo no se tocan. Cuando un caso ya quedó
cargado en Kiwi, su bloque se puede borrar de acá (se anota en la tabla).

Los títulos de los casos salen de `.github/workflows/performance.yml`, que
arma el JUnit que se sube a Kiwi. Todos los casos miden contra staging con
20 usuarios o 20 mesas, como los objetivos de la Línea de Base.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`. Sin credenciales, tokens reales ni URLs de entornos: el
repositorio es público.

## TC-P-001

### Precondición

- Staging desplegado y despierto: `performance.yml` espera a que respondan los servicios antes de medir.
- El restaurante de testing del seed tiene la carta cargada.

### Pasos

1. `k6/load-test.js` levanta 20 usuarios virtuales durante 60 s.
2. Cada usuario pide el menú público del restaurante de testing (`GET /menu/tenant/:tenantId/restaurante/:restauranteId`) y espera 1 s entre pedidos.

### Resultado esperado

- El p95 del tiempo de respuesta es menor a 1,5 s.
- Menos del 1 % de los pedidos falla.
- k6 termina con código 0 (todos los umbrales cumplidos).

## TC-P-004

### Precondición

- Staging desplegado y despierto.
- Usuario ADMIN del tenant de testing.
- El restaurante de testing tiene al menos 20 números de mesa libres (el máximo es 99).

### Pasos

1. Ingresar como ADMIN y abrir el mapa de mesas (`/admin/mesas`).
2. Crear 20 mesas por la API (`POST /mesas/layout`), con los números libres más altos, en una grilla de 5 x 4.
3. Recargar el mapa y verificar que `GET /mesas/layout` trae las 20 mesas nuevas.
4. Arrastrar una de las mesas nuevas durante 3 s con el mouse, sin soltarla, mientras se cuentan los frames que dibuja el navegador.
5. Soltar la mesa sin guardar el mapa y borrar las 20 mesas por la API, aunque el test haya fallado.

### Resultado esperado

- El editor dibuja 30 FPS o más durante el arrastre (RD.05).
- El editor muestra «Cambios sin guardar»: el arrastre se hizo de verdad.
- Las 20 mesas de prueba quedan borradas y el mapa del restaurante queda como estaba.
