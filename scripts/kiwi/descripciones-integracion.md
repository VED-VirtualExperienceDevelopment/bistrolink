# Descripciones de los casos de integración (Kiwi TCMS)

Plantilla para cargar en Kiwi la descripción de casos TC-I nuevos o que
cambiaron. La usa `cargar-casos-integracion.mjs --descripciones`.

## Cómo se usa

1. Agregar al final de este archivo un bloque por caso, con el formato del
   ejemplo de abajo (sin la sangría): un encabezado `## TC-I-NNN` en su
   propia línea y debajo `### Precondición`, `### Pasos` y
   `### Resultado esperado`.
2. Ver qué va a cambiar:
   `node scripts/kiwi/cargar-casos-integracion.mjs --descripciones`
3. Cargar:
   `node scripts/kiwi/cargar-casos-integracion.mjs --aplicar --descripciones`
4. Verificar con el comando del paso 2: tiene que decir «0 para actualizar».

El script reemplaza la descripción de cada caso que tenga un bloque acá, y
solo si cambió. Los casos sin bloque no se tocan. Una vez cargados, los
bloques se pueden borrar de este archivo: la descripción queda en Kiwi, que
es donde se consulta.

Reglas:

- El caso tiene que existir en el Test Plan «Integration tests». Si es nuevo,
  el mismo comando con `--aplicar` lo crea antes de cargar la descripción.
- Sin credenciales, URLs de entornos ni datos personales: el repositorio es
  público.

## Ejemplo

    ## TC-I-082

    ### Precondición
    Usuario ADMIN de prueba (`TEST_ADMIN_USERNAME` / `TEST_ADMIN_PASSWORD`).

    ### Pasos
    1. `POST /ruta` con un body válido.

    ### Resultado esperado
    201 Created. Lo que tiene que pasar en la base o en Keycloak.

## Casos para cargar
