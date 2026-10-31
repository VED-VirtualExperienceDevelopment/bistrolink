# ADR 0007 — Carga segura de imágenes de la carta

| Campo | Valor |
| --- | --- |
| Estado | Aceptada |
| Fecha | 21/10/2026 (implementada el 23/10/2026) |
| Referencias | BL-385 a BL-391; HU-005; Ley 18.331 |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

Las imágenes de los ítems se subían directo a S3 con una URL firmada y se publicaban tal cual llegaban. S3 solo controla el tipo de archivo **declarado**, no el contenido. Además, las fotos tomadas con un celular incluyen metadatos con la ubicación GPS, que es un dato personal según la Ley 18.331, y no había límite de píxeles.

## Decisión

Ninguna imagen llega a la carta sin que el servidor la verifique y la regenere. El flujo es subida → cuarentena → procesamiento → publicación, siguiendo la guía de OWASP sobre subida de archivos:

1. **Subida a la cuarentena.** El navegador sube el archivo con una URL firmada a `incoming/{tenant}/{uuid}`. La key no usa el nombre del archivo del cliente. Una regla de ciclo de vida del bucket borra la cuarentena al día.
2. **Confirmación en la API.** Verifica que la key sea del tenant del token, consulta el tamaño real sin descargar (máximo 5 MB), decodifica la imagen, rechaza las de más de 25 megapíxeles y genera un WebP nuevo, de hasta 1600 px y **sin metadatos**.
3. **Publicación.** La imagen se guarda en `{tenant}/menu/{uuid}.webp`, con el tipo de contenido y la caché fijados por la API. Los ítems solo aceptan keys con ese formato y que existan en el bucket.
4. **Permisos.** Solo el rol Administrador puede subir, con límite de pedidos por minuto, y el cambio de imagen queda en la auditoría.

El procesamiento corre en la propia API, con la librería `sharp`.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Procesar en una función serverless (AWS Lambda) | Suma un servicio y un despliegue más. El volumen de imágenes de una carta no lo justifica. |
| Antivirus en el bucket (Amazon GuardDuty) | Costo adicional. El riesgo se cubre regenerando la imagen: lo que se publica no es el archivo subido. |
| Validar solo el tipo declarado | Un archivo que no es una imagen podría publicarse con tipo de imagen. |

## Consecuencias

- Lo publicado siempre es una imagen generada por el servidor, liviana y sin datos personales.
- Las imágenes subidas antes de este cambio se reprocesaron con un script de una sola vez (BL-390).
- El formato fijo de las keys publicadas permite servirlas por una CDN leyendo solo `*/menu/*` (ADR 0008).
- El procesamiento consume memoria de la API durante la confirmación; el límite de píxeles y el de pedidos por minuto lo acotan.
