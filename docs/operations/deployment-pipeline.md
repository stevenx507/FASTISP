# Pipeline de Despliegue por Bloques

## Objetivo
Tener despliegues repetibles y auditables para cada bloque funcional liberado a produccion.

## Flujo recomendado
1. Commit por bloque (`feat(block-n): ...`).
2. Push a `main`.
3. CI valida build/tests.
4. Ejecucion manual de `Deploy VPS` desde GitHub Actions.
5. Verificacion post-deploy:
   - `/api/health`
   - login por rol
   - smoke de modulo tocado

## Workflow incluido
- Archivo: `.github/workflows/deploy-vps.yml`
- Inputs:
  - `target`: `staging` o `production`
  - `migrate_db`: aplica migraciones
  - `rebuild_services`: rebuild de backend/frontend

## Secrets requeridos
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT` (opcional)
- `VPS_APP_DIR` (opcional, default `~/fastisp`)

## Criterio de rollback
- Si falla smoke o health-check:
  1. Revisar logs backend/frontend.
  2. Volver al commit/tag anterior.
  3. Re-ejecutar deploy con revision estable.
