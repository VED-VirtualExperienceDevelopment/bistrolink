# ADR 0008 — Imágenes de la carta del comensal por CDN con URL estable

| Campo | Valor |
| --- | --- |
| Estado | Aceptada |
| Fecha | 31/10/2026 |
| Tickets | BL-199 (implementación), BL-446 (solicitud de cambio), BL-438 (rendimiento del menú) |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

El menú del comensal (por QR y por URL directa) mostraba las imágenes de la carta con URLs prefirmadas de S3 con un TTL de una hora. La firma (`X-Amz-Date`, `X-Amz-Signature`) cambiaba en cada request, así que:

- el navegador no reutilizaba las imágenes entre visitas;
- una CDN no podía cachearlas;
- si alguien dejaba el menú abierto más de una hora, las URLs vencían.

Lighthouse en celular marcaba las fotos de la carta como recursos sin política de caché, y eran una de las causas del rendimiento bajo del menú (BL-438).

Las imágenes de la carta no son contenido privado: las ve cualquier comensal que tenga el link del local. El criterio [S] de HU-001 pedía URLs firmadas para que el bucket no quedara expuesto, no para ocultar las imágenes.

## Decisión

Las imágenes de la carta del comensal se sirven desde **Amazon CloudFront** con una URL estable:

1. **El bucket sigue privado.** Una distribución de CloudFront se pone delante del bucket de imágenes de cada entorno con **Origin Access Control**, y el bucket mantiene *Block all public access*.
2. **Solo se lee lo publicado.** La política del bucket permite a la distribución leer únicamente `*/menu/*`: las imágenes que pasaron por la carga segura y el reprocesamiento (BL-385, BL-386; ADR 0007). La cuarentena `incoming/` y cualquier otro prefijo responden 403.
3. **El backend arma la URL de la CDN** con `StorageService.urlImagenPublica`, solo para las keys `{tenant}/menu/{uuid}.webp` y solo si está definida la variable `IMAGES_CDN_URL`. Sin esa variable (en local, con MinIO) firma la URL como antes.
4. **Caché de un año sin invalidaciones.** Las imágenes publicadas se guardan con `Cache-Control: public, max-age=31536000, immutable`. Cada imagen confirmada tiene una key nueva, así que nunca se sobrescribe un objeto.
5. **El resto sigue con URL prefirmada y TTL:** el panel de administración, la confirmación de imágenes y los CFE.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Lectura pública del prefijo `*/menu/*` en S3 | Expone el bucket directamente y no suma una CDN ni puntos de presencia cercanos al comensal. |
| URLs firmadas estables por ventana de tiempo | Mantienen la firma, pero la URL igual cambia al cambiar la ventana y la caché de la CDN no es efectiva. |
| Mantener las URLs prefirmadas | No resuelve la caché ni el vencimiento. |

## Consecuencias

- La misma imagen tiene siempre la misma URL: la caché de CloudFront y la del navegador funcionan. En staging se sirve desde el punto de presencia de Buenos Aires.
- Una imagen publicada queda accesible para quien tenga su URL, que incluye un UUID no adivinable. Es el mismo nivel de exposición que el menú del comensal, que es público.
- Se agrega un servicio de infraestructura por entorno. Su costo entra en la capa gratuita de CloudFront (1 TB y 10 millones de solicitudes por mes).
- Producción necesita su propia distribución y su propio `IMAGES_CDN_URL` con el release v0.5.0 (BL-220).
- Las imágenes subidas antes de la carga segura (`items/` y archivos con el nombre original) no se sirven por la CDN.
