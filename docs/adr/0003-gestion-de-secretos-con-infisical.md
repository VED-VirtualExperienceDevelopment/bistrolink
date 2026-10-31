# ADR 0003 — Gestión de secretos con Infisical como fuente única

| Campo | Valor |
| --- | --- |
| Estado | Aceptada; implementación en curso |
| Fecha | 30/09/2026 |
| Referencias | Anexo 4 §1.2.5 (RNF.02); Anexo 9 §2.4 y §2.5; BL-227, BL-235 a BL-239 |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

Las credenciales de staging (bases, Keycloak, AWS, proveedores de pago y facturación) estaban cargadas a mano en Railway y en los secrets de GitHub, sin sellar y legibles por cualquier integrante con acceso al proyecto. No había un inventario ni una rotación documentada por proveedor, que pide el paquete 1.2.5 del Anexo 4. Los roles del equipo rotan entre Sprints, así que el acceso a las credenciales también tiene que poder cambiar sin pasar contraseñas de mano en mano.

## Decisión

**Infisical Cloud** (plan gratuito) es la **fuente única** de las credenciales, con sincronización en un solo sentido:

- un proyecto con un entorno por ambiente (staging y producción) y una carpeta por servicio;
- Infisical sincroniza hacia Railway (servicios que usan credenciales) y hacia GitHub (secrets del repositorio y del environment de producción);
- Railway y GitHub son **destinos**: ningún valor se edita a mano ahí, y las credenciales sincronizadas se sellan en Railway;
- solo las **credenciales** van a Infisical. La configuración no sensible (nombres de buckets, regiones, URLs públicas) y las referencias entre servicios de Railway se quedan en Railway;
- el acceso es por rol: al rotar el rol de Security Engineer se cambian los permisos en Infisical.

El procedimiento está en el runbook `docs/runbooks/gestion-de-secretos.md`, con el inventario de secretos y su rotación por proveedor.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Seguir cargando las variables a mano en Railway y GitHub | Sin fuente única, sin auditoría de accesos y con valores legibles por todo el equipo. |
| AWS Secrets Manager o HashiCorp Vault | Costo por secreto o infraestructura propia que operar. Sin integración nativa con Railway. |
| Variables solo en GitHub y despliegue desde Actions | Railway no recibiría las credenciales de los servicios que no despliega el pipeline (Keycloak, Kiwi TCMS, respaldos). |

## Consecuencias

- Un solo lugar para cargar, rotar y auditar credenciales, con registro de quién leyó o cambió cada una.
- Cumple una práctica de OWASP ASVS nivel 2 (gestor de secretos), por encima del nivel 1 comprometido.
- Agrega un proveedor externo. Si Infisical no está disponible, los servicios siguen con los últimos valores sincronizados; una rotación urgente sigue el procedimiento manual del runbook.
- Mientras la sincronización no esté activa (BL-237), las variables nuevas se siguen cargando en Railway, y hay que pasarlas a Infisical al activarla.
