# Playbook Operativo Enterprise

Este playbook define la capa de proceso para operar FASTISP con estandares tipo NOC/ISP enterprise.

## Bloques implementados

1. Gobierno operativo:
- SOPs versionables via `GET/POST /api/admin/ops/sops`
- Checklist por proceso (alta cliente, cambio plan, mantenimiento)

2. Control de cambios:
- Registro de cambios via `POST /api/admin/ops/change-requests`
- Flujo de estados: `requested -> approved -> scheduled -> executing -> done`
- Cierre/rollback auditado

3. Guardrails live:
- OLT live requiere:
  - `live_confirm=true`
  - `change_ticket`
  - `preflight_ack=true`
- MikroTik acciones criticas requieren `change_ticket`:
  - reboot
  - execute-script
  - back-to-home (enable/add/remove/bootstrap)
  - enterprise hardening live
  - enterprise rollback
  - enterprise failover-test
- Si `require_preflight_for_live=true`, las acciones live de MikroTik tambien exigen `preflight_ack=true`.
- Ajustable por settings:
  - `change_control_required_for_live`
  - `require_preflight_for_live`

4. Preflight ejecutivo:
- `GET /api/admin/ops/preflight/summary`
- Evalua: control de cambios, cobertura MFA, recencia de backups, salud base de routers

5. SLO operativo:
- `GET /api/admin/ops/slo-summary`
- KPIs:
  - disponibilidad routers
  - cumplimiento SLA tickets
  - exito de operaciones de provision
- Targets configurables en settings

6. Seguridad:
- MFA opcional por usuario + enforcement global `admin_mfa_required`
- Politica de password centralizada con longitud minima y complejidad

7. Continuidad:
- Job `backup_restore_drill` en `/api/admin/system/jobs/run`
- Valida recencia y legibilidad basica de backup DB + presencia de artefactos OLT

## Recomendacion de operacion

1. Activar `admin_mfa_required`.
2. Mantener `change_control_required_for_live=true`.
3. Ejecutar `backup_restore_drill` semanal.
4. Revisar `preflight/summary` antes de cualquier ventana live.
5. Revisar `slo-summary` en comite operativo semanal.
