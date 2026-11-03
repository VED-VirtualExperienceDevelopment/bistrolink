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

## TC-E-066

### Precondición

Administrador del establecimiento del seed logueado en el panel.

### Pasos

1. Desde el menú, abrir «Reportes».
2. Elegir el período «Últimos 7 días».
3. Elegir el canal «Web».
4. Mirar el canal WhatsApp.
5. Revisar la pantalla con axe-core (WCAG 2.1 AA).

### Resultado esperado

1. Se abre «Reportes» con el período de hoy: la API responde 200, se ven las tarjetas (Total vendido, …) y las tablas equivalentes de los gráficos están en la página.
2. La API responde 200 con los últimos 7 días y el chip queda elegido.
3. La API responde 200 y la rotación de mesas dice «No aplica».
4. Está deshabilitado, con «Próximamente».
5. Sin errores graves ni críticos de accesibilidad.

## TC-E-067

### Precondición

Administrador logueado en «Reportes».

### Pasos

1. Elegir el período «Personalizado».
2. Poner «Desde» 31/12/2026 y «Hasta» 01/01/2026.

### Resultado esperado

1. Aparecen los campos «Desde» y «Hasta».
2. Aparece el aviso de que hay que elegir las dos fechas con «desde» igual o anterior a «hasta», los campos quedan marcados como inválidos y no se consulta la API con esas fechas.

## TC-E-068

### Precondición

Mozo del establecimiento del seed logueado en el panel.

### Pasos

1. Mirar el menú lateral.
2. Entrar directo a /admin/reportes.

### Resultado esperado

1. No aparece «Reportes».
2. Vuelve al mapa de mesas.
