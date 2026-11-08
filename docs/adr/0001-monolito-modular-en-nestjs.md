# ADR 0001 — Monolito modular en NestJS

| Campo | Valor |
| --- | --- |
| Estado | Aceptada |
| Fecha | Anteproyecto (2026); ratificada en la Línea de Base (28/09/2026) |
| Referencias | Línea de Base §3.3.2; Anexo 7 (arquitectura en capas) |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

BistroLink tiene varios dominios: carta, pedidos, mesas, pagos, facturación electrónica, POS, reportes e identidad. Los desarrolla un equipo de tres personas, en ocho Sprints, con un presupuesto de infraestructura acotado a planes gratuitos o de bajo costo. El tráfico esperado es el de un restaurante piloto.

## Decisión

El backend es un **monolito modular** en NestJS:

- un módulo por dominio, con dependencias explícitas entre módulos (por ejemplo, `PagosModule` usa `CfeModule` a través de su servicio exportado);
- un único despliegue (`bistrolink-api`) y una única base de negocio;
- tiempo real embebido en la misma instancia (Socket.IO), sin un servicio aparte;
- integraciones externas detrás de interfaces propias (puertos y adaptadores), para poder cambiar de proveedor sin tocar la lógica de negocio.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Microservicios por dominio | Multiplica despliegues, bases, pipelines, observabilidad y comunicación entre servicios. Es un costo operativo que un equipo de tres no puede sostener en el plazo. |
| Monolito sin módulos (todo en una capa) | Acopla dominios y vuelve más difícil separar responsabilidades, probar y, a futuro, extraer un módulo. |

## Consecuencias

- Un solo pipeline y un solo despliegue: el ciclo de cambio es corto y las pruebas de integración cubren el sistema completo.
- Los límites entre módulos permiten extraer uno a un servicio propio más adelante, si el volumen lo justifica.
- La escala horizontal tiene dos requisitos que hoy no aplican a una sola instancia: el adaptador de Redis para Socket.IO y el almacenamiento compartido del rate limiting (`@nestjs/throttler`). Quedan documentados para el paso a operación real.
- Una falla grave de la API afecta a todos los dominios a la vez. Se mitiga con health checks, rollback a la imagen anterior y el runbook de contingencia.
