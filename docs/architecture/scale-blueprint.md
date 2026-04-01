# ISPFAST Scale Blueprint

This blueprint maps the enterprise-scale initiatives to concrete implementation artifacts.

## 1. Multi-tenant foundation
- Added `Tenant` model and tenant foreign keys in `backend/app/models.py`.
- Auth now supports tenant scoping through `X-Tenant-ID` and JWT claim `tenant_id`.
- Tenant context helpers are centralized in `backend/app/tenancy.py`.

## 2. Queue-driven execution
- Celery tasks now use lock-based idempotency in `backend/app/tasks.py`.
- Added async router operation task: `app.tasks.execute_router_operation`.

## 3. Stateless + autoscaling runtime
- Kubernetes manifests with HPA for backend/frontend/worker in `deploy/k8s/`.

## 4. Data-layer scaling posture
- Tenant-aware indexes and unique constraints added in `backend/app/models.py`.
- Daily KPI aggregation service added in `backend/app/services/analytics_service.py`.

## 5. Observability
- Request tracing and structured request logs added in `backend/app/init.py`.
- Response headers include `X-Request-ID` and `X-Response-Time-Ms`.

## 6. Security hardening
- Production config enforces strong secrets and required environment variables.
- JWT now carries tenant claims to enforce isolation.

## 7. API versioning
- Versioned aliases are available under `/api/v1` in `backend/app/init.py`.

## 8. Backup / DR readiness
- Backup verification scripts:
  - `scripts/ops/backup-and-verify.ps1`
  - `scripts/ops/backup-and-verify.sh`
- DR runbook in `docs/operations/disaster-recovery.md`.

## 9. NOC automation
- Rule engine: `backend/app/services/noc_automation_service.py`.
- Rule catalog: `backend/app/services/rules/noc_alert_rules.json`.
- Scheduled evaluation task: `app.tasks.evaluate_noc_alerts`.

## 10. Data platform baseline
- KPI materialization task: `app.tasks.compute_daily_network_kpis`.
- KPI service for capacity planning in `backend/app/services/analytics_service.py`.
