# BistroLink — Guía de commits

## Requisitos

- Git Bash (recomendado en Windows) o WSL
- Clave SSH configurada en GitHub
- Estar dentro del repositorio `bistrolink`

---

## Comando

```bash
npm run commit
```

---

## Flujos disponibles

### Flujo 1 — Commit nuevo desde develop

El flujo estándar. Partís desde `develop`, el script crea una rama nueva y pushea.

```
develop (actualizado) → rama nueva → commit → push → PR
```

**Pasos:**
1. Asegurate de estar en `develop`
2. Corré `npm run commit`
3. Confirmá el `git status`
4. Seleccioná tipo, ID de Linear y descripción
5. Confirmá — el script crea la rama, commitea y pushea
6. Abrí el PR con el link que aparece al final

---

### Flujo 2 — Commit adicional en una rama existente

Si ya tenés una rama abierta (`feat/BL-42-...`) y querés agregar más cambios antes de mergear el PR.

```
rama existente → nuevo commit → push
```

**Pasos:**
1. Asegurate de estar en tu rama de feature
2. Corré `npm run commit`
3. El script detecta que estás en una rama de feature y te pregunta:
   - `1` → Commitear en esta rama (default)
   - `2` → Volver a develop y crear una rama nueva
4. Si la rama está desactualizada respecto a `develop`, el script te avisa y ofrece hacer rebase
5. El tipo y el ID de Linear se pre-completan desde el nombre de la rama — presioná Enter para mantenerlos

---

## Convención de nombres

### Ramas
```
tipo/BL-NNN-descripcion-en-slug
```
Ejemplos:
```
feat/BL-042-autenticacion-keycloak
fix/BL-101-error-en-login
ci/BL-022-optimizar-pipeline
```

### Commits
```
tipo(BL-NNN): descripción en minúsculas
```
Ejemplos:
```
feat(BL-042): agregar autenticación con keycloak
fix(BL-101): corregir error en pantalla de login
ci(BL-022): optimizar jobs paralelos en pipeline
```

### Tipos válidos

| Tipo       | Uso                              |
|------------|----------------------------------|
| `feat`     | Nueva funcionalidad              |
| `fix`      | Corrección de bug                |
| `chore`    | Dependencias / configuración     |
| `ci`       | Pipeline / scripts CI            |
| `docs`     | Documentación                    |
| `test`     | Pruebas                          |
| `refactor` | Refactorización sin cambio de comportamiento |
| `perf`     | Mejora de rendimiento            |
| `revert`   | Revertir un commit anterior      |

---

## Reglas del repositorio

- **No se puede pushear directo a `develop` ni a `main`** — ambas ramas están protegidas
- Todo cambio entra por PR desde una rama de feature hacia `develop`
- `main` solo se actualiza manualmente desde GitHub Web
- El mensaje de commit debe incluir el ID de Linear (`BL-NNN`) — el hook lo valida automáticamente

---

## Setup inicial (Windows)

El script copia la clave SSH automáticamente si usás WSL. Si usás **Git Bash** (recomendado), las claves de `C:\Users\tuusuario\.ssh` se usan directamente sin configuración extra.

En ambos casos, la clave pública debe estar cargada en GitHub:
**github.com → Settings → SSH and GPG keys → New SSH key**

Para obtener tu clave pública:
```bash
cat ~/.ssh/id_ed25519.pub
```

---

## Errores comunes

| Error | Causa | Solución |
|-------|-------|----------|
| `Permission denied (publickey)` | Clave SSH no configurada en GitHub | Agregá tu clave pública en GitHub Settings |
| `protected branch hook declined` | Push directo a develop o main | Usá siempre `npm run commit` desde develop |
| `El scope debe incluir el ID de Linear` | Commit manual sin formato correcto | Usá `npm run commit` o seguí el formato `tipo(BL-NNN): descripción` |
| `cannot pull with rebase: You have unstaged changes` | Versión vieja del script | Actualizá `scripts/commit.sh` con la última versión |
| `La rama ya existe localmente` | Ya creaste esa rama antes | El script te ofrece hacer checkout de la existente |

---

## Flujo completo del pipeline (CI/CD)

Una vez pusheado el PR, GitHub Actions corre automáticamente:

```
PR abierto
    ├── 🔍 Lint (ESLint + Prettier)
    ├── 🧪 Tests unitarios (Jest)
    ├── 🤝 Tests de contrato (PactJS)
    ├── 🔐 Secretos (Gitleaks)
    ├── 🛡️  SAST (CodeQL)
    ├── 📊 SAST (SonarCloud)
    └── 📦 Dependencias (Snyk)
            └── 🐳 Build + Trivy
                    └── 🚀 Deploy staging (solo en develop)
                            └── 🎭 E2E Playwright
```

El merge solo está disponible cuando todos los checks pasan.

---

## Después del merge — npm run sync

Una vez que el PR fue mergeado en GitHub, corré:

```bash
npm run sync
```

Este comando:
1. Cambia a `develop` si estás en otra rama
2. Hace `git pull origin develop` para traer los cambios mergeados
3. Ofrece eliminar la rama local que ya fue mergeada
4. Limpia referencias a ramas remotas eliminadas (`git fetch --prune`)
5. Muestra los últimos 5 commits para confirmar que todo está al día

### Flujo completo recomendado

```
npm run commit        → creás la rama, commiteás y pusheás
↓
Abrís el PR en GitHub
↓
El pipeline CI/CD corre automáticamente
↓
Se aprueba y mergea el PR en GitHub
↓
npm run sync          → volvés a develop limpio y actualizado
↓
npm run commit        → siguiente tarea
```
