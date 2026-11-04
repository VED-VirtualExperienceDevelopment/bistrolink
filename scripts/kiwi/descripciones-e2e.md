# Descripciones de los casos E2E (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                         |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 27/10/2026 | Plantilla (BL-435).                                                                                                                                  |
| 1.1     | 28/10/2026 | TC-E-046 a 049: cobro en efectivo (BL-201), solicitud de efectivo (BL-442) y pedido del mozo (BL-209).                                               |
| 1.2     | 31/10/2026 | TC-E-007 y 008 cambian: la carta por URL muestra los agotados bloqueados, igual que el QR (BL-397).                                                  |
| 1.3     | 31/10/2026 | TC-E-050 a 055: Gestión de Carta (BL-392 / BL-402).                                                                                                  |
| 1.4     | 01/11/2026 | TC-E-056 a 058: medios de pago del comensal según la configuración del local (BL-452).                                                               |
| 1.5     | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-059 a 061: retomar el pago al recargar y aviso de efectivo en el KDS (BL-448).          |
| 1.6     | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-062: política de privacidad desde la carta y el pago (BL-206).                          |
| 1.7     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-063 y 064: e-Factura con RUT y razón social desde la pantalla de pago (HU-009, BL-453). |
| 1.8     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-063 cambia: sin aceptar el aviso no se avisa al mozo (BL-453, ajuste de staging).       |
| 1.9     | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-065: comprobantes del administrador y su estado ante la DGI (HU-009, BL-455).           |
| 1.10    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-066 a 068: dashboard de reportes del administrador (HU-012, BL-108).                    |
| 1.11    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-069 a 071: stock de la jornada y campana de alertas de stock (HU-015, BL-120).          |

Plantilla para cargar en Kiwi la descripción de casos TC-E (Playwright)
nuevos o que cambiaron (BL-435). La usa
`cargar-casos-integracion.mjs --e2e --descripciones`.

## Cómo se usa

1. Agregar al final de este archivo un bloque por caso, con el formato del
   ejemplo de abajo (sin la sangría): un encabezado `## TC-E-NNN` en su
   propia línea y debajo `### Precondición`, `### Pasos` y
   `### Resultado esperado`.
2. Ver qué va a cambiar:
   `node scripts/kiwi/cargar-casos-integracion.mjs --e2e --descripciones`
3. Cargar:
   `node scripts/kiwi/cargar-casos-integracion.mjs --e2e --aplicar --descripciones`
4. Verificar con el comando del paso 2: tiene que decir «0 para actualizar».

El script reemplaza la descripción de cada caso que tenga un bloque acá, y
solo si cambió. Los casos sin bloque no se tocan. Una vez cargados, los
bloques se pueden borrar de este archivo: la descripción queda en Kiwi, que
es donde se consulta.

Reglas:

- El caso tiene que existir en el Test Plan «E2E-Playwright». Si es nuevo,
  el mismo comando con `--aplicar` lo crea antes de cargar la descripción.
- Sin credenciales, URLs de entornos ni datos personales: el repositorio es
  público.

## Ejemplo

    ## TC-E-040

    ### Precondición
    Usuario de prueba y datos que necesita el test.

    ### Pasos
    1. Lo que hace el test en la pantalla.

    ### Resultado esperado
    Lo que tiene que verse.

## Casos para cargar

## TC-E-069

### Precondición

Staging con el usuario administrador del seed. El test crea por la API una categoría «E2E stock …» con un ítem sin control de stock y la elimina al terminar.

### Pasos

1. Como administrador, abrir Stock desde el menú lateral.
2. Revisar la fila del ítem de prueba.
3. Activar «Controlar stock», cargar 2 unidades y cambiar el aviso de 5 a 3, y tocar Guardar.
4. Abrir la campana del header.
5. Revisar la pantalla con axe-core (WCAG 2.1 AA).

### Resultado esperado

1. Se abre «Stock de la jornada» y la API responde 200.
2. Sin control de stock, los campos de unidades y aviso están deshabilitados y Guardar también.
3. Se avisa «Hay 1 ítem con cambios sin guardar.»; al guardar, el PATCH responde 200 y lleva solo ese ítem con lo que cambió; se anuncia «Se guardó 1 ítem.» y la fila pasa a «Por agotarse».
4. La campana muestra el ítem con «Quedan 2 · aviso en 3».
5. Sin errores graves ni críticos.

## TC-E-070

### Precondición

Staging con el usuario administrador del seed. El test crea por la API un ítem de prueba con control de stock, 0 unidades y aviso en 5, y lo elimina al terminar.

### Pasos

1. Abrir la campana y cerrarla con Escape.
2. Con el foco en la campana, abrirla con Enter y moverse con Fin e Inicio.
3. Elegir el ítem de prueba: se abre «Reponer stock».
4. Cargar «2,5» y guardar.
5. Cargar 20 y guardar.
6. Abrir la campana.

### Resultado esperado

1. El ítem aparece como «Agotado»; con Escape se cierra y el foco vuelve a la campana.
2. Enter abre el menú con el foco en la primera alerta; Fin va a «Ver el stock de la jornada» e Inicio vuelve a la primera alerta.
3. El diálogo «Reponer stock: …» se abre con el foco en «Unidades disponibles ahora».
4. Se muestra «Usá un número entero, sin decimales.» y el campo queda marcado como inválido.
5. El PATCH responde 200, el diálogo se cierra y el foco vuelve a la campana.
6. El ítem ya no está en las alertas.

## TC-E-071

### Precondición

Staging con el usuario mozo del seed.

### Pasos

1. Como mozo, abrir /admin/mesas.
2. Ir a /admin/stock por la URL.

### Resultado esperado

1. No hay campana de stock en el header ni «Stock» en el menú.
2. Vuelve al mapa de mesas.
