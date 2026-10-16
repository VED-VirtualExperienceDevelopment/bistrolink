# Cómo contribuir a BistroLink

## Reglas de seguridad (obligatorias)

El repositorio y la organización son **públicos**. Cualquier persona puede ver el código, los commits y los comentarios.

### Nunca commitear

- Contraseñas, API keys, tokens o secretos de cualquier tipo.
- Archivos `.env` con valores. Para documentar variables se usa `.env.example`, con los valores vacíos.
- Cadenas de conexión a bases de datos con credenciales.
- Certificados privados o archivos `.pfx`.
- URLs o IPs que contengan tokens.
- Respuestas de login guardadas a mano (por ejemplo, `token_response*.json`). El `.gitignore` ya las excluye.

### Dónde van los secretos

- **Aplicación (staging y production):** en el gestor de secretos del equipo, que los sincroniza con Railway.
- **Pipeline:** en los secretos de GitHub Actions del repositorio.

### Si se commiteó un secreto por error

1. **No** alcanza con borrarlo en otro commit: el historial ya es público.
2. Revocá o rotá la credencial en el proveedor **de inmediato**.
3. Avisale al equipo.
4. Pedile a un Owner que limpie el historial con `git filter-repo`.

Gitleaks revisa el historial en cada PR y corta el pipeline si encuentra un secreto.

## Flujo de trabajo

1. Cada cambio tiene un ticket en Linear (`BL-NNN`). Los bugs se reportan como GitHub Issues, que se sincronizan con Linear.
2. Se parte de `develop` actualizado y se trabaja en una rama propia (`feat/BL-NNN-...`, `fix/BL-NNN-...`, etc.).
3. Los commits se hacen con `npm run commit`, que arma el mensaje con el formato `tipo(BL-NNN): descripción`. Ver [docs/COMMITS.md](docs/COMMITS.md).
4. Se abre un PR contra `develop`. Para mergear hace falta la revisión de otro integrante y todos los controles obligatorios en verde.
5. Al mergear en `develop`, el cambio se despliega en staging.
6. **Release:** PR de `develop` a `main` con _merge commit_ (no _squash_) y tag `vX.Y.Z` sobre `main`, con aprobación manual para desplegar en `production`.

## Archivos

- Fin de línea **LF** en todos los archivos (lo fuerza `.gitattributes`).
- Antes de abrir el PR, correr lint y tests desde la carpeta de cada app (`apps/backend` o `apps/frontend`).
