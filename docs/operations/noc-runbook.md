# NOC Automation Runbook

## Inputs
- Router health snapshots from `MikroTikService.get_system_health()`
- Rules from `backend/app/services/rules/noc_alert_rules.json`

## Task flow
1. `app.tasks.poll_mikrotik_metrics` collects metrics and evaluates rules.
2. `app.tasks.evaluate_noc_alerts` runs independent alert pass for auditability.
3. Alerts are logged with structured payload for SIEM/log pipeline ingestion.

## Severity policy
- `critical`: immediate escalation, on-call engineer paged
- `high`: respond within 15 minutes
- `medium`: review within 1 hour

## Recommended extensions
- Persist alerts in database table with lifecycle state.
- Integrate alert output with Slack/Teams/PagerDuty.
- Add remediation playbooks keyed by `rule_id`.
